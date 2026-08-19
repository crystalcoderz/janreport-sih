import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { DashboardClient } from "@/components/dashboard/dashboard-client";

export default async function DashboardPage() {
  const profile = await getCurrentProfile();
  const supabase = await createClient();

  const [{ data: issues }, { data: departments }] = await Promise.all([
    supabase
      .from("issues")
      .select("*, departments(name), teams(name)")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("departments").select("*").order("name"),
  ]);

  return (
    <DashboardClient
      initialIssues={issues ?? []}
      departments={departments ?? []}
      profile={profile!}
    />
  );
}
