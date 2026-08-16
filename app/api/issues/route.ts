import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { classifyIssuePhoto } from "@/lib/ai/classify";
import { reverseGeocode } from "@/lib/geo";
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
  // whether or not a row is ever written. Counted from `issues` itself
  // rather than a rate-limit table, so this needs no migration. Generous
  // enough that a genuine reporter walking a street never notices.
  const { count: recentByUser } = await supabase
    .from("issues")
    .select("id", { count: "exact", head: true })
    .eq("reporter_id", user.id)
    .gte("created_at", new Date(Date.now() - REPORT_WINDOW_MS).toISOString());

  if ((recentByUser ?? 0) >= MAX_REPORTS_PER_WINDOW) {
    return NextResponse.json(
      {
        error:
          "You've filed a lot of reports in the last hour. Please try again shortly.",
      },
      { status: 429 }
    );
  }

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
  if (!classification.isCivicIssue) {
    return NextResponse.json(
      {
        error:
          "That photo doesn't appear to show a civic issue. Please photograph the problem itself and try again.",
        classification,
      },
      { status: 422 }
    );
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
      .select("id")
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
  const admin = createServiceRoleClient();
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

  await pushNearbyIssueAlerts(issue.id);

  return NextResponse.json({ issue }, { status: 201 });
}
