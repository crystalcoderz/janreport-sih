import { Badge } from "@/components/ui/badge";
import type { IssueStatus } from "@/lib/supabase/types";

const STATUS_CONFIG: Record<IssueStatus, { label: string; className: string }> = {
  reported: {
    label: "Reported",
    className: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
  },
  acknowledged: {
    label: "Acknowledged",
    className: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  },
  in_progress: {
    label: "In Progress",
    className:
      "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  },
  resolved: {
    label: "Resolved",
    className:
      "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  },
  rejected: {
    label: "Rejected",
    className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  },
};

export function StatusBadge({ status }: { status: IssueStatus }) {
  const config = STATUS_CONFIG[status];
  return (
    <Badge variant="outline" className={config.className}>
      {config.label}
    </Badge>
  );
}
