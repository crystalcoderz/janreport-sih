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

export function slaHoursFor(severity: number): number {
  // Ordered high→low; first bucket whose ceiling still covers this score.
  const match = [...SLA_HOURS]
    .sort((a, b) => a.maxSeverity - b.maxSeverity)
    .find((b) => severity <= b.maxSeverity);
  return match?.hours ?? 168;
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
