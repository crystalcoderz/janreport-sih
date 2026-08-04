"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { formatDistanceToNow } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { SeverityBadge } from "@/components/issue/severity-badge";
import { StatusBadge } from "@/components/issue/status-badge";
import { IssueTimeline, type TimelineEntry } from "@/components/issue/issue-timeline";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import type { Database } from "@/lib/supabase/types";
import { toast } from "sonner";
import { useNotificationPermission } from "@/lib/hooks/use-notification-permission";
import { Bell } from "lucide-react";
import { useTranslation } from "@/lib/i18n/context";
import type { TranslationKey } from "@/lib/i18n/translations";

function categoryKey(category: string): TranslationKey {
  return `category.${category}` as TranslationKey;
}

type Issue = Database["public"]["Tables"]["issues"]["Row"] & {
  departments?: { name: string } | null;
};
type HistoryRow = Database["public"]["Tables"]["issue_status_history"]["Row"] & {
  profiles?: { full_name: string | null } | null;
};

export function MyReportsClient({
  initialIssues,
  history,
  userId,
}: {
  initialIssues: Issue[];
  history: HistoryRow[];
  userId: string;
}) {
  const [issues, setIssues] = useState<Issue[]>(initialIssues);
  const [historyRows, setHistoryRows] = useState<HistoryRow[]>(history);
  const { permission, request, notify } = useNotificationPermission();
  const { t } = useTranslation();

  useEffect(() => {
    const supabase = createClient();
    // Unique per effect invocation — see use-issue-notifications.ts for why
    // (Strict Mode dev double-invoke + supabase-js channel topic reuse).
    const channel = supabase
      .channel(`my-reports-${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "issues",
          filter: `reporter_id=eq.${userId}`,
        },
        (payload) => {
          const updated = payload.new as Issue;
          setIssues((prev) =>
            prev.map((issue) =>
              issue.id === updated.id ? { ...issue, ...updated } : issue
            )
          );
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "issue_status_history" },
        (payload) => {
          const row = payload.new as HistoryRow;
          setIssues((prevIssues) => {
            const match = prevIssues.find((i) => i.id === row.issue_id);
            if (match) {
              const statusLabel = row.status.replace("_", " ");
              toast.info(`"${match.title}" is now ${statusLabel}`);
              if (document.visibilityState === "hidden") {
                notify(`JanReport: ${match.title}`, {
                  body: `Status updated to ${statusLabel}`,
                  icon: "/icon.svg",
                });
              }
            }
            return prevIssues;
          });
          setHistoryRows((prev) => [...prev, row]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, notify]);

  const historyByIssue = useMemo(() => {
    const map = new Map<string, TimelineEntry[]>();
    for (const row of historyRows) {
      const list = map.get(row.issue_id) ?? [];
      list.push({
        id: row.id,
        status: row.status,
        note: row.note,
        changed_at: row.changed_at,
        officerName: row.profiles?.full_name,
      });
      map.set(row.issue_id, list);
    }
    return map;
  }, [historyRows]);

  if (issues.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-center">
        <p className="text-lg font-medium">{t("myReports.emptyTitle")}</p>
        <p className="text-muted-foreground">{t("myReports.emptyDescription")}</p>
        <Button
          nativeButton={false}
          render={<Link href="/report">{t("myReports.emptyCta")}</Link>}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("myReports.title")}</h1>
          <p className="text-muted-foreground">{t("myReports.description")}</p>
        </div>
        {permission === "default" && (
          <Button variant="outline" size="sm" onClick={request}>
            <Bell className="size-4" />
            {t("myReports.enableNotifications")}
          </Button>
        )}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {issues.map((issue) => (
          <Card key={issue.id}>
            <CardContent className="flex flex-col gap-4 pt-6">
              <div className="flex gap-3">
                <Image
                  src={issue.photo_url}
                  alt={issue.title}
                  width={80}
                  height={80}
                  unoptimized
                  className="size-20 shrink-0 rounded-md object-cover"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-medium">{issue.title}</p>
                    <StatusBadge status={issue.status} />
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {t(categoryKey(issue.ai_category))}{" "}
                    · {issue.departments?.name ?? "Unassigned"}
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <SeverityBadge severity={issue.ai_severity} />
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(issue.created_at), {
                        addSuffix: true,
                      })}
                    </span>
                  </div>
                </div>
              </div>
              <IssueTimeline
                createdAt={issue.created_at}
                entries={historyByIssue.get(issue.id) ?? []}
              />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
