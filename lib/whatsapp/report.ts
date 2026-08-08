import { createServiceRoleClient } from "@/lib/supabase/server";
import { classifyIssuePhoto } from "@/lib/ai/classify";
import { reverseGeocode, forwardGeocode, googleMapsLink } from "@/lib/geo";
import { CATEGORY_LABELS, type IssueCategory } from "@/lib/departments";
import { getOrCreateProfileByPhone } from "@/lib/whatsapp/profile";
import { uploadIssuePhoto } from "@/lib/storage";
import { pushNearbyIssueAlerts } from "@/lib/push/fanout";

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const DEDUPE_RADIUS_M = 75;

// Jharkhand's timezone — the app has no other locale/timezone setting, so
// this keeps "reported at" times readable for citizens instead of UTC.
function formatIstDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(iso));
}

export async function savePhotoToSession(
  phone: string,
  buffer: Buffer,
  mimeType: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (buffer.byteLength > MAX_PHOTO_BYTES) {
    return { ok: false, error: "That photo is too large — please send one under 8MB." };
  }
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("whatsapp_report_sessions").upsert({
    phone,
    photo_base64: buffer.toString("base64"),
    photo_mime_type: mimeType,
    updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: "Could not save your photo. Please try again." };
  return { ok: true };
}

export async function saveLocationToSession(
  phone: string,
  lat: number,
  lng: number
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("whatsapp_report_sessions").upsert({
    phone,
    lat,
    lng,
    updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: "Could not save your location. Please try again." };
  return { ok: true };
}

// Discards whatever photo/location/note this phone has queued up — the
// citizen's way to abandon an in-progress report instead of it silently
// sitting there. Also what unsticks a stale session that's blocking the
// fresh-conversation greeting on the next "hi".
export async function clearReportSession(phone: string): Promise<void> {
  const supabase = createServiceRoleClient();
  await supabase.from("whatsapp_report_sessions").delete().eq("phone", phone);
}

// For citizens reporting an issue they're not currently standing at (an
// older photo, GPS unavailable) — resolves a free-text description to
// coordinates and stores it exactly like a shared GPS location, so the
// rest of the flow (dedupe, reverse-geocode-on-file, etc.) doesn't need to
// know which path produced the location.
export async function saveAddressToSession(
  phone: string,
  address: string
): Promise<
  | { ok: true; formattedAddress: string; mapsLink: string }
  | { ok: false; error: string }
> {
  const geocoded = await forwardGeocode(address);
  if (!geocoded) {
    return {
      ok: false,
      error: "Could not find that location. Try adding more detail — area, landmark, or city.",
    };
  }
  const saved = await saveLocationToSession(phone, geocoded.lat, geocoded.lng);
  if (!saved.ok) return saved;
  return {
    ok: true,
    formattedAddress: geocoded.formattedAddress,
    mapsLink: googleMapsLink(geocoded.lat, geocoded.lng),
  };
}

export async function saveNoteToSession(phone: string, note: string): Promise<void> {
  const supabase = createServiceRoleClient();
  await supabase.from("whatsapp_report_sessions").upsert({
    phone,
    note: note.slice(0, 500),
    updated_at: new Date().toISOString(),
  });
}

// Asked fresh for every report rather than read from profiles.full_name —
// most WhatsApp citizens have no profile name at all, and the person
// messaging may be reporting on someone else's behalf. Used to personalize
// the officer-facing acknowledgement letter.
export async function saveReporterNameToSession(phone: string, name: string): Promise<void> {
  const supabase = createServiceRoleClient();
  await supabase.from("whatsapp_report_sessions").upsert({
    phone,
    reporter_name: name.trim().slice(0, 100),
    updated_at: new Date().toISOString(),
  });
}

// What's currently sitting in this phone's in-progress report, so the
// agent can be told what it still needs instead of guessing.
// Abandoned sessions (citizen sent a photo, then never came back) would
// otherwise silently block the "fresh conversation" greeting forever — a
// session this old is treated as if nothing were in progress, even though
// the row itself is left alone (cancel_report / a new file_new_report call
// still overwrites it normally).
const SESSION_STALE_AFTER_MS = 2 * 60 * 60 * 1000; // 2 hours

export async function getReportSessionState(phone: string): Promise<{
  hasPhoto: boolean;
  hasLocation: boolean;
  hasNote: boolean;
  hasName: boolean;
}> {
  const supabase = createServiceRoleClient();
  const { data: session } = await supabase
    .from("whatsapp_report_sessions")
    .select("photo_base64, lat, lng, note, reporter_name, updated_at")
    .eq("phone", phone)
    .maybeSingle();

  const stale =
    !!session && Date.now() - new Date(session.updated_at).getTime() > SESSION_STALE_AFTER_MS;
  if (!session || stale) {
    return { hasPhoto: false, hasLocation: false, hasNote: false, hasName: false };
  }

  return {
    hasPhoto: Boolean(session.photo_base64),
    hasLocation: session.lat != null && session.lng != null,
    hasNote: Boolean(session.note),
    hasName: Boolean(session.reporter_name),
  };
}

export type FinalizeReportResult =
  | { status: "incomplete"; hasPhoto: boolean; hasLocation: boolean; hasName: boolean }
  | {
      status: "duplicates";
      category: string;
      severity: string;
      duplicates: {
        id: string;
        title: string;
        address: string | null;
        photoUrl: string;
        mapsLink: string;
        reportedAt: string;
      }[];
    }
  | {
      status: "filed";
      issue: {
        id: string;
        title: string;
        category: string;
        severity: string;
        confidence: number;
        department: string | null;
        mapsLink: string;
        reporterName: string;
      };
    }
  | { status: "error"; message: string };

// Classifies + files the report sitting in this phone's session (mirroring
// the web /api/issues flow, including the dedupe check the old rigid
// webhook explicitly skipped). Returns a structured result instead of
// sending a WhatsApp message itself — the calling agent
// (lib/kimi/tools.ts's file_new_report) composes the actual reply, in
// whatever language the citizen is using, so there's exactly one place
// user-facing text comes from instead of this function and the agent
// both trying to talk to them.
export async function finalizeReportIfReady(
  phone: string,
  options?: { forceNew?: boolean }
): Promise<FinalizeReportResult> {
  const supabase = createServiceRoleClient();
  const { data: session } = await supabase
    .from("whatsapp_report_sessions")
    .select("*")
    .eq("phone", phone)
    .maybeSingle();

  if (
    !session ||
    !session.photo_base64 ||
    session.lat === null ||
    session.lng === null ||
    !session.reporter_name
  ) {
    return {
      status: "incomplete",
      hasPhoto: Boolean(session?.photo_base64),
      hasLocation: session?.lat != null && session?.lng != null,
      hasName: Boolean(session?.reporter_name),
    };
  }

  const profile = await getOrCreateProfileByPhone(phone);
  if (!profile) {
    return { status: "error", message: "Could not set up your account. Please try again." };
  }

  let classification;
  try {
    classification = await classifyIssuePhoto({
      imageBase64: session.photo_base64,
      mimeType: session.photo_mime_type ?? "image/jpeg",
      note: session.note ?? undefined,
    });
  } catch (err) {
    console.error("WhatsApp classification failed", err);
    return { status: "error", message: "Could not process that photo. Please try sending it again." };
  }

  if (!options?.forceNew) {
    const { data: nearby, error: nearbyError } = await supabase.rpc("nearby_open_issues", {
      p_category: classification.category,
      p_lng: session.lng,
      p_lat: session.lat,
      p_radius_m: DEDUPE_RADIUS_M,
    });

    if (nearbyError) {
      console.error("WhatsApp dedupe lookup failed", nearbyError);
    } else if (nearby && nearby.length > 0) {
      return {
        status: "duplicates",
        category: CATEGORY_LABELS[classification.category as IssueCategory] ?? classification.category,
        severity: classification.severityLabel,
        duplicates: nearby.map((n) => ({
          id: n.id,
          title: n.title,
          address: n.address,
          photoUrl: n.photo_url,
          mapsLink: googleMapsLink(n.lat, n.lng),
          reportedAt: formatIstDateTime(n.created_at),
        })),
      };
    }
  }

  const buffer = Buffer.from(session.photo_base64, "base64");
  const ext = (session.photo_mime_type ?? "image/jpeg").split("/")[1]?.replace("jpeg", "jpg") || "jpg";
  const path = `${profile.id}/${crypto.randomUUID()}.${ext}`;

  let publicUrl: string;
  try {
    ({ publicUrl } = await uploadIssuePhoto({
      supabase,
      path,
      body: buffer,
      contentType: session.photo_mime_type ?? "image/jpeg",
    }));
  } catch (uploadError) {
    console.error("WhatsApp photo upload failed", uploadError);
    return { status: "error", message: "Could not save your photo. Please try again." };
  }

  const [address, departmentResult] = await Promise.all([
    reverseGeocode(session.lat, session.lng),
    supabase
      .from("departments")
      .select("id, name")
      .contains("category_keys", [classification.category])
      .limit(1)
      .maybeSingle(),
  ]);

  const { data: issue, error: insertError } = await supabase
    .from("issues")
    .insert({
      reporter_id: profile.id,
      title: classification.title,
      description: classification.description,
      ai_category: classification.category,
      ai_severity: classification.severity,
      ai_severity_label: classification.severityLabel,
      ai_confidence: classification.confidence,
      photo_url: publicUrl,
      lat: session.lat,
      lng: session.lng,
      address: address ?? undefined,
      department_id: departmentResult.data?.id ?? null,
      reporter_name: session.reporter_name,
    })
    .select("*, departments(name)")
    .single();

  await supabase.from("whatsapp_report_sessions").delete().eq("phone", phone);

  if (insertError || !issue) {
    console.error("WhatsApp issue insert failed", insertError);
    return { status: "error", message: "Could not save your report. Please try again." };
  }

  await pushNearbyIssueAlerts(issue.id);

  return {
    status: "filed",
    issue: {
      id: issue.id,
      title: issue.title,
      category: CATEGORY_LABELS[classification.category as IssueCategory] ?? classification.category,
      severity: classification.severityLabel,
      confidence: classification.confidence,
      department: issue.departments?.name ?? null,
      mapsLink: googleMapsLink(issue.lat, issue.lng),
      reporterName: session.reporter_name,
    },
  };
}
