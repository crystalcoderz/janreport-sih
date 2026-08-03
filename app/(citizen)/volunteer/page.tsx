import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { VolunteerDirectory } from "@/components/citizen/volunteer-directory";

export default async function VolunteerPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();
  const { data: groups } = await supabase
    .from("volunteer_groups")
    .select("*")
    .order("verified", { ascending: false })
    .order("created_at", { ascending: false });

  return (
    <VolunteerDirectory
      userId={profile.id}
      canVerify={profile.role === "officer" || profile.role === "admin"}
      initialGroups={groups ?? []}
    />
  );
}
