"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CATEGORY_LABELS, type IssueCategory } from "@/lib/departments";
import { useNotificationPermission } from "@/lib/hooks/use-notification-permission";
import { toast } from "sonner";
import type { Database } from "@/lib/supabase/types";

export interface NearbyAlert {
  id: string;
  issueId: string;
  createdAt: string;
  readAt: string | null;
  issueTitle: string;
  issueCategory: string;
  issueAddress: string | null;
}

type NotificationRow = Database["public"]["Tables"]["issue_notifications"]["Row"];

export function useIssueNotifications(userId: string, initial: NearbyAlert[]) {
  const [alerts, setAlerts] = useState<NearbyAlert[]>(initial);
  const { notify } = useNotificationPermission();

  useEffect(() => {
    const supabase = createClient();
    // Unique per effect invocation (not per component instance) — React
    // Strict Mode's dev-only mount/cleanup/mount double-invoke can run
    // this before the previous channel's async removeChannel() finishes,
    // and supabase-js reuses an existing channel with a matching topic,
    // which throws "cannot add postgres_changes callbacks after
    // subscribe()" on the second .on() call. A fresh topic each run
    // sidesteps that entirely.
    const channel = supabase
      .channel(`issue-notifications-${userId}-${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "issue_notifications",
          filter: `recipient_id=eq.${userId}`,
        },
        async (payload) => {
          const row = payload.new as NotificationRow;
          const { data: issue } = await supabase
            .from("issues")
            .select("title, ai_category, address")
            .eq("id", row.issue_id)
            .single();

          const categoryLabel = issue
            ? CATEGORY_LABELS[issue.ai_category as IssueCategory] ?? issue.ai_category
            : "issue";

          const alert: NearbyAlert = {
            id: row.id,
            issueId: row.issue_id,
            createdAt: row.created_at,
            readAt: row.read_at,
            issueTitle: issue?.title ?? "A nearby issue",
            issueCategory: issue?.ai_category ?? "other",
            issueAddress: issue?.address ?? null,
          };

          setAlerts((prev) => [alert, ...prev]);
          toast.warning(`${categoryLabel} reported nearby`, {
            description: alert.issueAddress ?? "Near your saved location — be aware.",
          });
          if (document.visibilityState === "hidden") {
            notify(`JanReport: ${categoryLabel} nearby`, {
              body: alert.issueAddress ?? "Reported near your saved location.",
              icon: "/icon.svg",
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, notify]);

  const unreadCount = alerts.filter((a) => !a.readAt).length;

  const markAllRead = useCallback(async () => {
    const unreadIds = alerts.filter((a) => !a.readAt).map((a) => a.id);
    if (unreadIds.length === 0) return;

    const now = new Date().toISOString();
    setAlerts((prev) =>
      prev.map((a) => (a.readAt ? a : { ...a, readAt: now }))
    );

    const supabase = createClient();
    await supabase
      .from("issue_notifications")
      .update({ read_at: now })
      .in("id", unreadIds);
  }, [alerts]);

  return { alerts, unreadCount, markAllRead };
}
