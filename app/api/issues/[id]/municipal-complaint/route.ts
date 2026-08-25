import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { sendMunicipalComplaint } from "@/lib/email/municipal";
import { resolveMunicipalRecipient } from "@/lib/email/municipal";
import { CATEGORY_LABELS, type IssueCategory } from "@/lib/departments";

export const runtime = "nodejs";

// Sends the formal complaint to the municipal body for a report that has not
// had one — or sends it again on request.
//
// Filing normally does this automatically, but two things leave a report
// without a complaint: it was filed before the municipal directory existed,
// and it was filed somewhere no verified office covers. The first is a
// backlog an officer should be able to clear; the second is a real gap that
// only new directory entries fix. Either way, an officer looking at a report
// that never reached anyone needs a way to send it, rather than the report
// sitting there looking filed while nothing happened.

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
    supabase.from("issues").select("*, departments(name)").eq("id", id).single(),
  ]);

  if (issueError || !issue) {
    return NextResponse.json({ error: "Issue not found." }, { status: 404 });
  }

  // Same rule as every other officer action on a report: an admin, or the
  // officer whose department owns it.
  const authorized =
    actor &&
    (actor.role === "admin" ||
      (actor.role === "officer" && actor.department_id === issue.department_id));
  if (!authorized) {
    return NextResponse.json(
      { error: "You don't have permission to send this complaint." },
      { status: 403 }
    );
  }

  const admin = createServiceRoleClient();

  // Sending the same complaint twice reads to a clerk as a duplicate and, if
  // it becomes a habit, as noise from an automated system. Requires an
  // explicit resend rather than refusing outright, because a genuine resend
  // does happen — a bounced address, an office that says it never arrived.
  const body = await request.json().catch(() => ({}));
  const resend = body?.resend === true;

  const { count: alreadySent } = await admin
    .from("municipal_emails")
    .select("id", { count: "exact", head: true })
    .eq("issue_id", id)
    .eq("direction", "outbound");

  if ((alreadySent ?? 0) > 0 && !resend) {
    return NextResponse.json(
      {
        error:
          "A complaint has already been sent for this report. Use Send again if you need to repeat it.",
        alreadySent: alreadySent ?? 0,
      },
      { status: 409 }
    );
  }

  // Resolved first so the failure is a clear message rather than a silent
  // no-op: "no office covers this location" is something the officer can act
  // on, by adding one to the directory.
  const recipient = await resolveMunicipalRecipient({
    departmentEmail: null,
    lat: issue.lat,
    lng: issue.lng,
  });

  if (!recipient) {
    return NextResponse.json(
      {
        error:
          "No municipal office is configured for this location, so there is nowhere to send it. Add one to the directory first.",
      },
      { status: 422 }
    );
  }

  const result = await sendMunicipalComplaint({
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
    viewUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/issues/${issue.id}`,
  });

  if (!result.sent) {
    return NextResponse.json(
      { error: `Could not send the complaint: ${result.reason ?? "unknown error"}` },
      { status: 502 }
    );
  }

  // Recorded on the timeline as well, so the report's own history shows that
  // somebody caused this rather than it appearing from nowhere.
  await admin.from("issue_status_history").insert({
    issue_id: issue.id,
    status: issue.status,
    note: `Complaint ${alreadySent ? "re-sent" : "sent"} to ${result.to}.`,
    changed_by: user.id,
  });

  return NextResponse.json({ sent: true, to: result.to, office: recipient.office?.name ?? null });
}
