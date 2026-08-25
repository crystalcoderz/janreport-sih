import type { IssueStatus } from "@/lib/supabase/types";

// Which status moves are legal, shared by the API route that enforces them and
// the officer form that offers them.
//
// It lives here because the two drifted apart the moment they were written
// separately: the route refused reported -> resolved while the dropdown still
// offered it, so the commonest action in the whole dashboard -- see a new
// report, do the work, mark it resolved -- answered 409, after the browser had
// already uploaded the proof photo and orphaned it in storage.
//
// Deliberately permissive. The thing worth preventing is a *repeat* of a state
// the report is already in, which re-sent the citizen's resolution email and
// re-ran AI verification; that is handled separately by comparing against the
// current status. What is left here only rules out moves that make no sense,
// and every state keeps a way out so a mis-click is never permanent.
export const ALLOWED_NEXT: Record<IssueStatus, IssueStatus[]> = {
  reported: ["acknowledged", "in_progress", "resolved", "rejected"],
  acknowledged: ["in_progress", "resolved", "rejected"],
  in_progress: ["acknowledged", "resolved", "rejected"],
  // Reopening a resolved report is a real thing: the fix did not hold, or the
  // citizen says it is still broken.
  resolved: ["in_progress", "rejected"],
  // An un-reject. Rejections are one click away from a mis-click, and without
  // this the report was frozen forever.
  rejected: ["reported", "acknowledged", "in_progress"],
};

/** True when this move is permitted. A move to the current status is not a move. */
export function isAllowedTransition(from: IssueStatus, to: IssueStatus): boolean {
  return ALLOWED_NEXT[from].includes(to);
}

/**
 * The statuses an officer may pick given where the report is now — the current
 * one included, because leaving the select alone and adding a note is a normal
 * thing to do.
 */
export function selectableStatuses(current: IssueStatus): IssueStatus[] {
  return [current, ...ALLOWED_NEXT[current]];
}
