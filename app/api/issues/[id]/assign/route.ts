import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Assigns (or clears) the field crew that owns this issue. RLS
// (issues_update_officer_admin) already restricts this to an officer in
// the issue's department or an admin, so there's no extra role check here
// — the update simply affects zero rows for anyone else.
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
  const teamId: string | null =
    typeof body?.teamId === "string" && body.teamId ? body.teamId : null;

  // Validate the crew before writing it. RLS decides *whether* this officer
  // may touch the issue, but not *what* they may put in the column — without
  // this an officer could dispatch any team id, including an inactive crew or
  // one belonging to another department.
  if (teamId) {
    const { data: target } = await supabase
      .from("issues")
      .select("department_id")
      .eq("id", id)
      .single();

    const { data: team } = await supabase
      .from("teams")
      .select("id, department_id, active")
      .eq("id", teamId)
      .maybeSingle();

    if (!team || !team.active) {
      return NextResponse.json(
        { error: "That crew doesn't exist or is no longer active." },
        { status: 400 }
      );
    }
    // Must match the trg_enforce_assigned_team_department trigger exactly,
    // which requires `department_id = new.department_id`. A crew with no
    // department can never satisfy that — NULL is not equal to anything — so
    // treating it as a general-purpose unit here just moved the rejection
    // into Postgres, where it surfaces to the officer as a failed save with
    // no explanation.
    if (!team.department_id) {
      return NextResponse.json(
        { error: "That crew has no department, so it can't be dispatched." },
        { status: 400 }
      );
    }
    if (team.department_id !== target?.department_id) {
      return NextResponse.json(
        { error: "That crew belongs to a different department." },
        { status: 400 }
      );
    }
  }

  const { data: issue, error } = await supabase
    .from("issues")
    .update({
      assigned_team_id: teamId,
      assigned_at: teamId ? new Date().toISOString() : null,
    })
    .eq("id", id)
    .select("*, teams(name, contact_phone)")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 403 });
  }

  // Record it on the timeline so the audit trail shows who dispatched
  // whom, not just status transitions.
  const teamName =
    (issue as { teams?: { name: string } | null }).teams?.name ?? null;
  const { error: historyError } = await supabase
    .from("issue_status_history")
    .insert({
      issue_id: id,
      status: issue.status,
      note: teamName ? `Assigned to ${teamName}` : "Assignment cleared",
      changed_by: user.id,
    });

  if (historyError) {
    console.error("Failed to record assignment history", historyError);
  }

  return NextResponse.json({ issue });
}
