import { getCurrentProfile } from "@/lib/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { LandingContent, type LandingStats } from "@/components/landing/landing-content";

// Aggregate counts only — no rows, no personal data. Read with the service
// role because the landing page is public and `issues` is readable only by
// signed-in users, and a visitor who hasn't signed in yet is exactly who
// these numbers are for.
async function getLandingStats(): Promise<LandingStats> {
  try {
    const supabase = createServiceRoleClient();
    const [reports, resolved, departments] = await Promise.all([
      supabase.from("issues").select("*", { count: "exact", head: true }),
      supabase
        .from("issues")
        .select("*", { count: "exact", head: true })
        .eq("status", "resolved"),
      supabase.from("departments").select("*", { count: "exact", head: true }),
    ]);
    return {
      reports: reports.count ?? 0,
      resolved: resolved.count ?? 0,
      departments: departments.count ?? 0,
    };
  } catch {
    // The landing page must render even if the database is unreachable.
    return { reports: 0, resolved: 0, departments: 0 };
  }
}

export default async function Home() {
  const [profile, stats] = await Promise.all([getCurrentProfile(), getLandingStats()]);
  // janreport.xyz points here, and that is the link being shared publicly, so
  // the root has to show the project rather than bouncing to WhatsApp: a
  // visitor who arrives from a post has not agreed to open a chat yet, and
  // the landing page is where the live stats and the "how it works" walkthrough
  // are. The WhatsApp funnel is still one tap away on the page itself.
  const primaryHref = profile
    ? profile.role === "officer" || profile.role === "admin"
      ? "/dashboard"
      : "/report"
    : "/login";

  return (
    <LandingContent
      signedIn={Boolean(profile)}
      primaryHref={primaryHref}
      stats={stats}
    />
  );
}
