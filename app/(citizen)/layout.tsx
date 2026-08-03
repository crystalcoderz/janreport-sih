import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { AppNav } from "@/components/layout/app-nav";

const CITIZEN_LINKS = [
  { href: "/report", label: "Report Issue" },
  { href: "/my-reports", label: "My Reports" },
  { href: "/map", label: "Map" },
  { href: "/leaderboard", label: "Leaderboard" },
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
    </div>
  );
}
