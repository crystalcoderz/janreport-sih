import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { verifyResolution } from "@/lib/ai/verify-resolution";
import { sendEmail } from "@/lib/email/client";
import { statusChangedEmail, resolvedEmail } from "@/lib/email/templates";
import { CATEGORY_LABELS, type IssueCategory } from "@/lib/departments";
import { sendWhatsAppText, isWhatsAppConfigured } from "@/lib/whatsapp/client";
import { isAllowedPhotoUrl } from "@/lib/storage";
import type { IssueStatus, ResolutionVerdict } from "@/lib/supabase/types";

export const runtime = "nodejs";

const VALID_STATUSES: IssueStatus[] = [
  "reported",
  "acknowledged",
  "in_progress",
  "resolved",
  "rejected",
];

export async function PATCH(
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

  const body = await request.json().catch(() => null);
  const status = body?.status as IssueStatus | undefined;
  const note: string | undefined = body?.note;
  const resolutionPhotoUrl: string | undefined = body?.resolutionPhotoUrl;

  if (!status || !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  // This URL is client-supplied and gets fetched server-side later for AI
  // verification, so it has to be pinned to our own storage hosts.
  if (resolutionPhotoUrl && !isAllowedPhotoUrl(resolutionPhotoUrl)) {
    return NextResponse.json(
      { error: "Resolution photo must be uploaded through JanReport." },
      { status: 400 }
    );
  }

  // Read before the write so the email can say what it moved *from*. Cheap,
  // and the alternative — inferring it from the history table — races with
  // the row this same request is about to insert.
  const { data: prior } = await supabase
    .from("issues")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  const previousStatus = (prior?.status ?? "reported") as IssueStatus;

  // RLS (issues_update_officer_admin) enforces that only an officer for
  // this issue's department, or an admin, can perform this update.
  const { data: issue, error: updateError } = await supabase
    .from("issues")
    .update({
      status,
      ...(status === "resolved" && resolutionPhotoUrl
        ? { resolution_photo_url: resolutionPhotoUrl }
        : {}),
      ...(note ? { resolution_note: note } : {}),
    })
    .eq("id", id)
    .select()
    .single();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 403 });
  }

  const { error: historyError } = await supabase
    .from("issue_status_history")
    .insert({ issue_id: id, status, note, changed_by: user.id });

  if (historyError) {
    console.error("Failed to record status history", historyError);
  }

  // AI-verified resolution: compare the officer's proof photo against the
  // citizen's original report. Best-effort — the status change already
  // succeeded above, and a verification failure must never undo it or
  // fail the request. A null verdict simply reads as "not verified".
  let verified = issue;
  if (status === "resolved" && issue.resolution_photo_url && issue.photo_url) {
    try {
      const result = await verifyResolution({
        beforeUrl: issue.photo_url,
        afterUrl: issue.resolution_photo_url,
        issueTitle: issue.title,
        category: issue.ai_category,
      });

      const { data: updated, error: verdictError } = await supabase
        .from("issues")
        .update({
          resolution_verdict: result.verdict,
          resolution_verdict_reason: result.reason,
          resolution_verdict_confidence: result.confidence,
          resolution_verified_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select()
        .single();

      if (verdictError) {
        console.error("Failed to persist resolution verdict", verdictError);
      } else if (updated) {
        verified = updated;
      }
    } catch (err) {
      console.error("Resolution verification failed", err);
    }
  }

  // Email the citizen, if they gave an address. After the verdict block on
  // purpose, so a resolution email carries the AI's verdict rather than
  // arriving first and contradicting it. Best-effort: the status change has
  // already succeeded and must not be undone by a mail failure.
  if (verified.reporter_email) {
    try {
      const data = {
        id: verified.id,
        title: verified.title,
        description: verified.description,
        category: CATEGORY_LABELS[verified.ai_category as IssueCategory] ?? verified.ai_category,
        severity: verified.ai_severity,
        severityLabel: verified.ai_severity_label,
        status: verified.status as IssueStatus,
        department: null,
        address: verified.address,
        lat: verified.lat,
        lng: verified.lng,
        photoUrl: verified.photo_url,
        reporterName: verified.reporter_name,
        createdAt: verified.created_at,
      };
      const viewUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/issues/${verified.id}`;
      const mail =
        status === "resolved"
          ? resolvedEmail(
              data,
              {
                verdict: verified.resolution_verdict ?? "unclear",
                reason: verified.resolution_verdict_reason,
                confidence: verified.resolution_verdict_confidence,
              },
              verified.resolution_photo_url,
              viewUrl
            )
          : statusChangedEmail(data, previousStatus, note, viewUrl);

      const sent = await sendEmail({ to: verified.reporter_email, ...mail });
      if (!sent.ok) console.error("Failed to email the status update", sent.error);
    } catch (err) {
      console.error("Status-update email threw", err);
    }
  }

  if (status === "resolved" && isWhatsAppConfigured()) {
    // Best-effort, never blocks the response — the status update (and the
    // verdict above) already succeeded regardless of whether this send works.
    notifyReporterOnWhatsApp(verified).catch((err) => {
      console.error("Failed to send WhatsApp resolution notice", err);
    });
  }

  return NextResponse.json({ issue: verified });
}

async function notifyReporterOnWhatsApp(issue: {
  id: string;
  title: string;
  reporter_id: string;
  resolution_verdict: ResolutionVerdict | null;
  resolution_verdict_reason: string | null;
}) {
  // Service-role client: the officer's session-scoped client isn't
  // guaranteed read access to another citizen's profile, and this lookup
  // is a server-side notification concern, not something the officer needs
  // visibility into beyond triggering it.
  const admin = createServiceRoleClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("phone")
    .eq("id", issue.reporter_id)
    .maybeSingle();

  if (!profile?.phone) return;

  let message: string;
  if (issue.resolution_verdict === "verified") {
    message = `✅ Good news — your report "${issue.title}" has been resolved, and our AI check confirms it looks fixed.${
      issue.resolution_verdict_reason ? ` ${issue.resolution_verdict_reason}` : ""
    }`;
  } else if (issue.resolution_verdict === "not_fixed") {
    message = `⚠️ Your report "${issue.title}" was marked resolved, but our AI check on the department's photo suggests it may not actually be fixed.${
      issue.resolution_verdict_reason ? ` ${issue.resolution_verdict_reason}` : ""
    } We've flagged this — reply here if it's still an issue.`;
  } else {
    message = `Your report "${issue.title}" has been marked resolved by the department. Check JanReport for details.`;
  }

  // Free-form text only works inside WhatsApp's 24h customer-service window
  // (e.g. the citizen messaged the bot recently); outside it this silently
  // fails to send, same known limitation as OTP delivery without an
  // approved template (see README).
  await sendWhatsAppText(profile.phone, message);
}
