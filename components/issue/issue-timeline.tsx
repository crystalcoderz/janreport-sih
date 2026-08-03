import { formatDistanceToNow } from "date-fns";
import type { IssueStatus } from "@/lib/supabase/types";

export interface TimelineEntry {
  id: string;
  status: IssueStatus;
  note: string | null;
  changed_at: string;
  officerName?: string | null;
}

export function IssueTimeline({
  createdAt,
  entries,
}: {
  createdAt: string;
  entries: TimelineEntry[];
}) {
  return (
    <ol className="flex flex-col gap-4">
      <li className="flex gap-3">
        <div className="mt-1 size-2 shrink-0 rounded-full bg-primary" />
        <div>
          <p className="text-sm font-medium">Reported</p>
          <p className="text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(createdAt), { addSuffix: true })}
          </p>
        </div>
      </li>
      {entries.map((entry) => (
        <li key={entry.id} className="flex gap-3">
          <div className="mt-1 size-2 shrink-0 rounded-full bg-primary" />
          <div>
            <p className="text-sm font-medium capitalize">
              {entry.status.replace("_", " ")}
            </p>
            {entry.note && (
              <p className="text-sm text-muted-foreground">{entry.note}</p>
            )}
            <p className="text-xs text-muted-foreground">
              {entry.officerName ?? "Officer"} ·{" "}
              {formatDistanceToNow(new Date(entry.changed_at), {
                addSuffix: true,
              })}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
