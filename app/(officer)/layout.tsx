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
    { href: "/dashboard", labelKey: "nav.dashboard" as const },
    ...(profile.role === "admin"
      ? [{ href: "/analytics", labelKey: "nav.analytics" as const }]
      : []),
  ];

  return (
    // Forced dark, regardless of system preference — a civic ops console,
    // not a marketing page, and every real one (Grafana, Datadog, an
    // actual municipal command centre) reads this way by convention. All
    // shared components already key off CSS variables rather than
    // hardcoded colors, so this is a safe, self-contained override.
    <div className="dark flex min-h-screen flex-1 flex-col bg-background text-foreground">
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
