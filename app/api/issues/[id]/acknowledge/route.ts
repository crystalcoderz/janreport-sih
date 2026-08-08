import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { generateAcknowledgementPdf } from "@/lib/pdf/acknowledgement";
import { uploadIssuePhoto } from "@/lib/storage";
import { sendWhatsAppDocument, isWhatsAppConfigured } from "@/lib/whatsapp/client";
import { CATEGORY_LABELS, type IssueCategory } from "@/lib/departments";

export const runtime = "nodejs";

// Generates the citizen-facing acknowledgement letter (formal note, their
// own photo, reported location, nearest municipal office) and sends it as
// a WhatsApp document. Marks acknowledgement_sent_at only once it's
// actually delivered — a PDF nobody received isn't an acknowledgement.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [{ data: actor }, { data: issue, error: issueError }] = await Promise.all([
    supabase.from("profiles").select("role, department_id").eq("id", user.id).single(),
    supabase
      .from("issues")
      .select("*, departments(name)")
      .eq("id", id)
      .single(),
  ]);

  if (issueError || !issue) {
    return NextResponse.json({ error: "Issue not found." }, { status: 404 });
  }

  // Fail fast before doing any of the expensive work below — this mirrors
  // issues_update_officer_admin exactly, so the eventual DB write can never
  // disagree with this check.
  const authorized =
    actor && (actor.role === "admin" || (actor.role === "officer" && actor.department_id === issue.department_id));
  if (!authorized) {
    return NextResponse.json(
      { error: "You don't have permission to acknowledge this report." },
      { status: 403 }
    );
  }

  // profiles.phone isn't in the citizen-facing column grant (see the RLS
  // hardening migration), so this goes through the service-role client —
  // same pattern as the resolution-verdict WhatsApp notification.
  const admin = createServiceRoleClient();
  const { data: reporterProfile } = await admin
    .from("profiles")
    .select("phone")
    .eq("id", issue.reporter_id)
    .maybeSingle();

  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await generateAcknowledgementPdf({
      issueId: issue.id,
      title: issue.title,
      category: issue.ai_category,
      severityLabel: issue.ai_severity_label,
      reporterName: issue.reporter_name,
      department: issue.departments?.name ?? null,
      address: issue.address,
      lat: issue.lat,
      lng: issue.lng,
      photoUrl: issue.photo_url,
    });
  } catch (err) {
    console.error("Failed to generate acknowledgement PDF", err);
    return NextResponse.json({ error: "Could not generate the acknowledgement letter." }, { status: 500 });
  }

  const path = `acknowledgements/${issue.id}-${Date.now()}.pdf`;
  let pdfUrl: string;
  try {
    ({ publicUrl: pdfUrl } = await uploadIssuePhoto({
      supabase: admin,
      path,
      body: Buffer.from(pdfBytes),
      contentType: "application/pdf",
    }));
  } catch (err) {
    console.error("Failed to upload acknowledgement PDF", err);
    return NextResponse.json({ error: "Could not save the acknowledgement letter." }, { status: 500 });
  }

  if (!reporterProfile?.phone) {
    return NextResponse.json({
      sent: false,
      pdfUrl,
      message: "This citizen has no WhatsApp number on file, so the letter couldn't be sent automatically. You can still download it below.",
    });
  }

  if (!isWhatsAppConfigured()) {
    return NextResponse.json({
      sent: false,
      pdfUrl,
      message: "WhatsApp isn't configured on this deployment. You can still download the letter below.",
    });
  }

  try {
    await sendWhatsAppDocument(
      reporterProfile.phone,
      pdfUrl,
      `JanReport-Acknowledgement-${issue.id.slice(0, 8)}.pdf`,
      `✅ Your report "${issue.title}" has been reviewed. Please find your acknowledgement letter attached.`
    );
  } catch (err) {
    // WhatsApp's 24h business-initiated messaging window is the likely
    // cause here if the citizen hasn't messaged recently — surface Meta's
    // actual reason rather than a generic failure.
    console.error("Failed to send acknowledgement via WhatsApp", err);
    return NextResponse.json({
      sent: false,
      pdfUrl,
      message:
        err instanceof Error
          ? `Could not send via WhatsApp: ${err.message}`
          : "Could not send via WhatsApp. You can still download the letter below.",
    });
  }

  const sentAt = new Date().toISOString();
  const { data: updated, error: updateError } = await supabase
    .from("issues")
    .update({ acknowledgement_sent_at: sentAt })
    .eq("id", id)
    .select()
    .single();

  if (updateError) {
    console.error("Failed to record acknowledgement timestamp", updateError);
  }

  const category = CATEGORY_LABELS[issue.ai_category as IssueCategory] ?? issue.ai_category;
  await supabase.from("issue_status_history").insert({
    issue_id: id,
    status: issue.status,
    note: `Acknowledgement letter sent to citizen via WhatsApp (${category}).`,
    changed_by: user.id,
  });

  return NextResponse.json({
    sent: true,
    pdfUrl,
    issue: updated ?? { ...issue, acknowledgement_sent_at: sentAt },
  });
}
