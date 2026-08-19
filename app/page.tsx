import { redirect } from "next/navigation";
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

// WhatsApp is the product, so the root is a funnel into it rather than a page
// about it. The "Hi" is prefilled deliberately: it matches GREETING_RE in the
// reporting webhook, so the citizen gets the welcome poster, voice notes and
// quick-report buttons instead of an empty chat they have to work out.
//
// Only signed-out visitors are sent away. Officers, admins and a citizen
// mid-session still get the web app, so the dashboard survives a demo, and
// /login, /map, /report and /dashboard stay directly addressable for everyone.
const WHATSAPP_CHAT_URL = "https://wa.me/31653826705?text=Hi";

export default async function Home() {
  const [profile, stats] = await Promise.all([getCurrentProfile(), getLandingStats()]);

  if (!profile) redirect(WHATSAPP_CHAT_URL);

  const primaryHref =
    profile.role === "officer" || profile.role === "admin" ? "/dashboard" : "/report";

  return (
    <LandingContent
      signedIn={Boolean(profile)}
      primaryHref={primaryHref}
      stats={stats}
    />
  );
}
