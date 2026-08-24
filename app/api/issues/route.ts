import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { classifyIssuePhoto, rejectionFor } from "@/lib/ai/classify";
import { reverseGeocode } from "@/lib/geo";
import { sendEmail } from "@/lib/email/client";
import { reportFiledEmail } from "@/lib/email/templates";
import { sendMunicipalComplaint } from "@/lib/email/municipal";
import { saveIssueContact } from "@/lib/issue-contact";
import { CATEGORY_LABELS, type IssueCategory } from "@/lib/departments";
import { pushNearbyIssueAlerts } from "@/lib/push/fanout";
import {
  uploadIssuePhoto,
  ALLOWED_IMAGE_TYPES,
  looksLikeAllowedImage,
} from "@/lib/storage";

export const runtime = "nodejs";

const DEDUPE_RADIUS_M = 75;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
// Report creation is the one public write that spends money (a Gemini vision
// call per attempt), so it gets a ceiling now that the link is public.
const REPORT_WINDOW_MS = 60 * 60 * 1000;
const MAX_REPORTS_PER_WINDOW = 10;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const photo = formData.get("photo");
  const lat = Number(formData.get("lat"));
  const lng = Number(formData.get("lng"));
  const note = formData.get("note")?.toString().slice(0, 500) || undefined;
  const forceNew = formData.get("forceNew") === "true";
  // Optional by design: a citizen without an email must still be able to
  // report. Trimmed and lowercased; a malformed value simply never receives
  // mail rather than blocking the report.
  const rawEmail = formData.get("email")?.toString().trim().toLowerCase() || undefined;
  const reporterEmail = rawEmail && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rawEmail) ? rawEmail : undefined;

  if (!(photo instanceof File)) {
    return NextResponse.json({ error: "Photo is required" }, { status: 400 });
  }
  if (!ALLOWED_IMAGE_TYPES.includes(photo.type as (typeof ALLOWED_IMAGE_TYPES)[number])) {
    return NextResponse.json(
      { error: "Photo must be a JPEG, PNG, or WebP image" },
      { status: 400 }
    );
  }
  if (photo.size > MAX_PHOTO_BYTES) {
    return NextResponse.json(
      { error: "Photo must be under 8MB" },
      { status: 400 }
    );
  }
  if (
    Number.isNaN(lat) ||
    Number.isNaN(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return NextResponse.json(
      { error: "A valid GPS location is required" },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await photo.arrayBuffer());

  // The declared type is just a client-supplied string; confirm the bytes.
  if (!looksLikeAllowedImage(buffer)) {
    return NextResponse.json(
      { error: "That file doesn't look like a real JPEG, PNG, or WebP image." },
      { status: 400 }
    );
  }

  // Deliberately the last check before the AI call, and deliberately after
  // the cheap validation above: classification is the only step here that
  // costs money, so a caller looping this endpoint bills us on every request
  // whether or not a row is ever written.
  //
  // Counted from attempts rather than from `issues`, because the two paths
  // that spend a Gemini call without writing a row -- a photo the junk screen
  // rejects, and a duplicate hit -- left the old counter at zero. Those were
  // exactly the requests worth limiting: they could be looped forever, each
  // one billed, and the cap never moved. Generous enough that a genuine
  // reporter walking a street never notices.
  const windowStart = new Date(Date.now() - REPORT_WINDOW_MS).toISOString();
  const admin = createServiceRoleClient();

  const { count: recentByUser } = await admin
    .from("report_attempts")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", windowStart);

  if ((recentByUser ?? 0) >= MAX_REPORTS_PER_WINDOW) {
    return NextResponse.json(
      {
        error:
          "You've filed a lot of reports in the last hour. Please try again shortly.",
      },
      { status: 429 }
    );
  }

  // Recorded before the call, not after: an attempt that throws still cost us
  // the request, and counting only successes would let a caller loop failures
  // for free.
  const { error: attemptError } = await admin
    .from("report_attempts")
    .insert({ user_id: user.id });
  if (attemptError) console.error("Failed to record a report attempt", attemptError);

  let classification;
  try {
    classification = await classifyIssuePhoto({
      imageBase64: buffer.toString("base64"),
      mimeType: photo.type,
      note,
    });
  } catch (err) {
    console.error("AI classification failed", err);
    return NextResponse.json(
      { error: "AI classification failed. Please try again." },
      { status: 502 }
    );
  }

  // Same guard as the WhatsApp path: do not create a report for a photo that
  // shows no civic issue. 422 rather than 400 — the request was well formed,
  // the content just is not reportable.
  const rejection = rejectionFor(classification);
  if (rejection) {
    return NextResponse.json({ error: rejection, classification }, { status: 422 });
  }

  if (!forceNew) {
    const { data: nearby, error: nearbyError } = await supabase.rpc(
      "nearby_open_issues",
      {
        p_category: classification.category,
        p_lng: lng,
        p_lat: lat,
        p_radius_m: DEDUPE_RADIUS_M,
      }
    );

    if (nearbyError) {
      console.error("Dedupe lookup failed", nearbyError);
    } else if (nearby && nearby.length > 0) {
      return NextResponse.json({ classification, duplicates: nearby });
    }
  }

  const ext = photo.type.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
  const path = `${user.id}/${crypto.randomUUID()}.${ext}`;

  let publicUrl: string;
  try {
    ({ publicUrl } = await uploadIssuePhoto({
      supabase,
      path,
      body: buffer,
      contentType: photo.type,
    }));
  } catch (uploadError) {
    console.error("Photo upload failed", uploadError);
    return NextResponse.json(
      { error: "Failed to upload photo" },
      { status: 500 }
    );
  }

  const [address, departmentResult] = await Promise.all([
    reverseGeocode(lat, lng),
    supabase
      .from("departments")
      .select("id, contact_email")
      .contains("category_keys", [classification.category])
      .limit(1)
      .maybeSingle(),
  ]);

  // Written with the service role so that `insert on issues` can be revoked
  // from `authenticated` — otherwise a citizen can POST straight to PostgREST
  // with their own session token and skip everything this route does: the
  // classification, the is-it-actually-a-civic-issue check, the duplicate
  // scan and the rate limit. The workflow-field trigger already stops them
  // forging a resolved, 9999-upvote issue, but nothing stopped them creating
  // arbitrary ones.
  //
  // Safe to bypass RLS here because every column below is server-derived:
  // reporter_id comes from the verified session, the rest from the
  // classifier. Nothing from the request body is spread in. The points
  // trigger keys off new.reporter_id rather than auth.uid(), so it still
  // fires correctly.
  const { data: issue, error: insertError } = await admin
    .from("issues")
    .insert({
      reporter_id: user.id,
      title: classification.title,
      description: classification.description,
      ai_category: classification.category,
      ai_severity: classification.severity,
      ai_severity_label: classification.severityLabel,
      ai_confidence: classification.confidence,
      photo_url: publicUrl,
      lat,
      lng,
      address: address ?? undefined,
      department_id: departmentResult.data?.id ?? null,
    })
    .select("*, departments(name)")
    .single();

  if (insertError) {
    console.error("Issue insert failed", insertError);
    return NextResponse.json(
      { error: "Failed to save the report" },
      { status: 500 }
    );
  }

  // Stored separately from the report itself — see lib/issue-contact.ts.
  await saveIssueContact(admin, issue.id, reporterEmail);

  await pushNearbyIssueAlerts(issue.id);

  // Confirmation email. Best-effort: the report is already saved.
  if (reporterEmail) {
    const mail = reportFiledEmail(
      {
        id: issue.id,
        reference: issue.reference ?? issue.id.slice(0, 8).toUpperCase(),
        title: issue.title,
        description: issue.description,
        category: CATEGORY_LABELS[issue.ai_category as IssueCategory] ?? issue.ai_category,
        severity: issue.ai_severity,
        severityLabel: issue.ai_severity_label,
        status: "reported",
        department: issue.departments?.name ?? null,
        address: issue.address,
        lat: issue.lat,
        lng: issue.lng,
        photoUrl: issue.photo_url,
        reporterName: issue.reporter_name,
        createdAt: issue.created_at,
      },
      `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/issues/${issue.id}`
    );
    const sent = await sendEmail({ to: reporterEmail, ...mail });
    if (!sent.ok) console.error("Failed to email the filed-report confirmation", sent.error);
  }

  // Formal intimation to the municipal body. Only goes anywhere if a
  // recipient has been configured — see municipalRecipient().
  await sendMunicipalComplaint({
    data: {
      id: issue.id,
      reference: issue.reference ?? issue.id.slice(0, 8).toUpperCase(),
      title: issue.title,
      description: issue.description,
      category: CATEGORY_LABELS[issue.ai_category as IssueCategory] ?? issue.ai_category,
      severity: issue.ai_severity,
      severityLabel: issue.ai_severity_label,
      department: issue.departments?.name ?? null,
      address: issue.address,
      lat: issue.lat,
      lng: issue.lng,
      photoUrl: issue.photo_url,
      reporterName: issue.reporter_name,
      reporterPhone: null,
      createdAt: issue.created_at,
    },
    departmentEmail: departmentResult.data?.contact_email,
    viewUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/issues/${issue.id}`,
  }).catch((err) => console.error("Municipal complaint send threw", err));

  return NextResponse.json({ issue }, { status: 201 });
}
