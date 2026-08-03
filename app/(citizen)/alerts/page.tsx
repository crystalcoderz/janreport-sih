import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AlertsClient } from "@/components/citizen/alerts-client";
import type { NearbyAlert } from "@/lib/hooks/use-issue-notifications";

export default async function AlertsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();
  const { data: notifications } = await supabase
    .from("issue_notifications")
    .select("*, issues(title, ai_category, address)")
    .eq("recipient_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(50);

  const initialAlerts: NearbyAlert[] = (notifications ?? []).map((n) => ({
    id: n.id,
    issueId: n.issue_id,
    createdAt: n.created_at,
    readAt: n.read_at,
    issueTitle: n.issues?.title ?? "A nearby issue",
    issueCategory: n.issues?.ai_category ?? "other",
    issueAddress: n.issues?.address ?? null,
  }));

  return (
    <AlertsClient
      userId={profile.id}
      homeLat={profile.home_lat}
      homeLng={profile.home_lng}
      notifyRadiusM={profile.notify_radius_m}
      initialAlerts={initialAlerts}
    />
  );
}
