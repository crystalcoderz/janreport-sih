import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { AppNav, type NavLink } from "@/components/layout/app-nav";
import { HelpChat } from "@/components/chat/help-chat";

const CITIZEN_LINKS: NavLink[] = [
  { href: "/report", labelKey: "nav.report" },
  { href: "/my-reports", labelKey: "nav.myReports" },
  { href: "/map", labelKey: "nav.map" },
  { href: "/alerts", labelKey: "nav.alerts" },
  { href: "/volunteer", labelKey: "nav.volunteer" },
  { href: "/leaderboard", labelKey: "nav.leaderboard" },
];

export default async function CitizenLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

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
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {children}
      </main>
      <HelpChat />
    </div>
  );
}
