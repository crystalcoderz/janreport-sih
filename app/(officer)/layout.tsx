import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { AppNav } from "@/components/layout/app-nav";

export default async function OfficerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "officer" && profile.role !== "admin") {
    redirect("/report");
  }

  const links = [
    { href: "/dashboard", label: "Dashboard" },
    ...(profile.role === "admin"
      ? [{ href: "/analytics", label: "Analytics" }]
      : []),
  ];

  return (
    <div className="flex flex-1 flex-col">
      <AppNav
        links={links}
        fullName={profile.full_name}
        roleBadge={profile.role}
      />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {children}
      </main>
    </div>
  );
}
