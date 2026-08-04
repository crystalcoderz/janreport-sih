import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AppNav, type NavLink } from "@/components/layout/app-nav";
import { NotificationBell } from "@/components/layout/notification-bell";
import type { NearbyAlert } from "@/lib/hooks/use-issue-notifications";
import { HelpChat } from "@/components/chat/help-chat";

const CITIZEN_LINKS: NavLink[] = [
  { href: "/report", labelKey: "nav.report" },
  { href: "/my-reports", labelKey: "nav.myReports" },
  { href: "/map", labelKey: "nav.map" },
  { href: "/alerts", labelKey: "nav.alerts" },
  { href: "/volunteer", labelKey: "nav.volunteer" },
];

export default async function CitizenLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();
  const { data: notifications } = await supabase
    .from("issue_notifications")
    .select("*, issues(title, ai_category, address)")
    .eq("recipient_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(20);

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
    <div className="flex flex-1 flex-col">
      <AppNav
        links={CITIZEN_LINKS}
        fullName={profile.full_name}
        roleBadge={
          profile.role === "officer" || profile.role === "admin"
            ? profile.role
            : undefined
        }
        notificationBell={
          <NotificationBell userId={profile.id} initialAlerts={initialAlerts} />
        }
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {children}
      </main>
      <HelpChat />
    </div>
  );
}
