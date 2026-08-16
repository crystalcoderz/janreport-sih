import type { IssueStatus } from "@/lib/supabase/types";

// How long an issue may sit un-actioned before it's flagged as overdue.
// Municipal SLAs are usually tighter for dangerous issues, so this scales
// with severity rather than being one flat number for everything.
export const SLA_HOURS: { maxSeverity: number; hours: number }[] = [
  { maxSeverity: 10, hours: 12 }, // critical (9-10): same-day
  { maxSeverity: 8, hours: 24 }, // high (7-8)
  { maxSeverity: 6, hours: 72 }, // moderate (5-6)
  { maxSeverity: 4, hours: 168 }, // low (<=4): one week
];

// Sorted once at module load. This used to clone and sort on every call, and
// the dashboard calls it from inside a sort comparator, so the work was
// quadratic in the number of issues on screen for a list that never changes.
const SLA_ASCENDING = [...SLA_HOURS].sort((a, b) => a.maxSeverity - b.maxSeverity);

export function slaHoursFor(severity: number): number {
  // Ordered low→high; first bucket whose ceiling still covers this score.
  return SLA_ASCENDING.find((b) => severity <= b.maxSeverity)?.hours ?? 168;
}

// "Overdue" only applies while an issue is still awaiting action —
// resolved and rejected issues are done, however long they took.
const OPEN_STATUSES: IssueStatus[] = ["reported", "acknowledged", "in_progress"];

export function isOverdue(issue: {
  status: IssueStatus;
  ai_severity: number;
  created_at: string;
}): boolean {
  if (!OPEN_STATUSES.includes(issue.status)) return false;
  const ageHours = (Date.now() - new Date(issue.created_at).getTime()) / 3_600_000;
  return ageHours > slaHoursFor(issue.ai_severity);
}

// Hours past the SLA deadline — used to sort the worst offenders first.
export function hoursOverdue(issue: {
  status: IssueStatus;
  ai_severity: number;
  created_at: string;
}): number {
  if (!isOverdue(issue)) return 0;
  const ageHours = (Date.now() - new Date(issue.created_at).getTime()) / 3_600_000;
  return Math.round(ageHours - slaHoursFor(issue.ai_severity));
}
