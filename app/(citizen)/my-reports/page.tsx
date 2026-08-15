import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MyReportsClient } from "@/components/citizen/my-reports-client";

export default async function MyReportsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: issues } = await supabase
    .from("issues")
    .select("*, departments(name)")
    .eq("reporter_id", user.id)
    .order("created_at", { ascending: false });

  const issueIds = (issues ?? []).map((i) => i.id);

  const { data: history } = issueIds.length
    ? await supabase
        .from("issue_status_history")
        .select("*, profiles(full_name)")
        .in("issue_id", issueIds)
        .order("changed_at", { ascending: true })
    : { data: [] };

  // Decides where the footer link points. The officer dashboard is behind
  // the (officer) route group, so offering it to a citizen would just
  // bounce them to /login — they get the public map instead.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <MyReportsClient
      initialIssues={issues ?? []}
      history={history ?? []}
      userId={user.id}
      isStaff={profile?.role === "officer" || profile?.role === "admin"}
    />
  );
}
