import { createServiceRoleClient } from "@/lib/supabase/server";
import { classifyIssuePhoto } from "@/lib/ai/classify";
import { reverseGeocode } from "@/lib/geo";
import { CATEGORY_LABELS, type IssueCategory } from "@/lib/departments";
import { getOrCreateProfileByPhone } from "@/lib/whatsapp/profile";
import { sendWhatsAppText } from "@/lib/whatsapp/client";
import { uploadIssuePhoto } from "@/lib/storage";
import { pushNearbyIssueAlerts } from "@/lib/push/fanout";

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

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

export async function saveNoteToSession(phone: string, note: string): Promise<void> {
  const supabase = createServiceRoleClient();
  await supabase.from("whatsapp_report_sessions").upsert({
    phone,
    note: note.slice(0, 500),
    updated_at: new Date().toISOString(),
  });
}

// If the session now has both a photo and a location, classifies + files
// the report (mirroring the /api/issues web flow) and replies with the
// result. No-ops if either piece is still missing. Duplicate detection is
// intentionally skipped here — a back-and-forth "is this a duplicate?"
// prompt doesn't map cleanly onto a WhatsApp conversation, so every
// WhatsApp report files as new.
export async function finalizeReportIfReady(phone: string): Promise<boolean> {
  const supabase = createServiceRoleClient();
  const { data: session } = await supabase
    .from("whatsapp_report_sessions")
    .select("*")
    .eq("phone", phone)
    .maybeSingle();

  if (!session?.photo_base64 || session.lat === null || session.lng === null) {
    return false;
  }

  const profile = await getOrCreateProfileByPhone(phone);
  if (!profile) {
    await sendWhatsAppText(phone, "Sorry, something went wrong setting up your account. Please try again.");
    return true;
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
    await sendWhatsAppText(
      phone,
      "Sorry, we couldn't process that photo. Please try sending it again."
    );
    return true;
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
    await sendWhatsAppText(phone, "Sorry, something went wrong saving your photo. Please try again.");
    return true;
  }

  const [address, departmentResult] = await Promise.all([
    reverseGeocode(session.lat, session.lng),
    supabase
      .from("departments")
      .select("id")
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
    })
    .select("*, departments(name)")
    .single();

  await supabase.from("whatsapp_report_sessions").delete().eq("phone", phone);

  if (insertError || !issue) {
    console.error("WhatsApp issue insert failed", insertError);
    await sendWhatsAppText(phone, "Sorry, something went wrong saving your report. Please try again.");
    return true;
  }

  await pushNearbyIssueAlerts(issue.id);

  const categoryLabel =
    CATEGORY_LABELS[classification.category as IssueCategory] ?? classification.category;
  await sendWhatsAppText(
    phone,
    `Report received! 📋\nCategory: ${categoryLabel}\nSeverity: ${classification.severityLabel}\nRouted to: ${
      issue.departments?.name ?? "the relevant department"
    }\n\nSign in to JanReport with this WhatsApp number to track it.`
  );
  return true;
}
