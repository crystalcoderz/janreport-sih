import { createServiceRoleClient } from "@/lib/supabase/server";
import { sendPushNotification, isPushConfigured } from "@/lib/push/client";
import { CATEGORY_LABELS, type IssueCategory } from "@/lib/departments";

// Called right after an issue insert. The geofencing trigger in
// schema.sql (notify_nearby_residents) already computed exactly who's
// within range and inserted their issue_notifications rows as part of the
// same transaction — this just reads that fan-out back and pushes to
// whichever of those recipients have a registered device, so the alert
// reaches them even with the app fully closed (Realtime only reaches an
// open tab).
export async function pushNearbyIssueAlerts(issueId: string): Promise<void> {
  if (!isPushConfigured()) return;

  const supabase = createServiceRoleClient();

  const { data: notifications } = await supabase
    .from("issue_notifications")
    .select("recipient_id, issues(title, ai_category, address)")
    .eq("issue_id", issueId);

  if (!notifications || notifications.length === 0) return;

  const recipientIds = notifications.map((n) => n.recipient_id);
  const { data: subscriptions } = await supabase
    .from("push_subscriptions")
    .select("*")
    .in("user_id", recipientIds);

  if (!subscriptions || subscriptions.length === 0) return;

  const issueMeta = (
    notifications[0] as {
      issues?: { title: string; ai_category: string; address: string | null } | null;
    }
  ).issues;
  const categoryLabel = issueMeta
    ? CATEGORY_LABELS[issueMeta.ai_category as IssueCategory] ?? issueMeta.ai_category
    : "Issue";
  const body = issueMeta?.address ?? issueMeta?.title ?? "Reported near your saved location.";

  const expiredIds: string[] = [];
  await Promise.all(
    subscriptions.map(async (sub) => {
      const result = await sendPushNotification(
        { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
        { title: `${categoryLabel} reported nearby`, body, url: "/alerts" }
      );
      if (!result.ok && result.expired) expiredIds.push(sub.id);
    })
  );

  if (expiredIds.length > 0) {
    await supabase.from("push_subscriptions").delete().in("id", expiredIds);
  }
}
