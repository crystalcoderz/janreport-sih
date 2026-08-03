import { createClient } from "@/lib/supabase/server";
import { MapPageClient } from "@/components/citizen/map-page-client";

export default async function MapPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: issues }, { data: myUpvotes }] = await Promise.all([
    supabase
      .from("issues")
      .select("*, departments(name)")
      .order("created_at", { ascending: false })
      .limit(500),
    user
      ? supabase.from("issue_upvotes").select("issue_id").eq("user_id", user.id)
      : Promise.resolve({ data: [] }),
  ]);

  return (
    <MapPageClient
      initialIssues={issues ?? []}
      upvotedIssueIds={(myUpvotes ?? []).map((u) => u.issue_id)}
    />
  );
}
