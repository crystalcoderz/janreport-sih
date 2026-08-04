import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyResolution } from "@/lib/ai/verify-resolution";
import type { IssueStatus } from "@/lib/supabase/types";

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

  return NextResponse.json({ issue: verified });
}
