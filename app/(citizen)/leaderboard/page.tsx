import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { LeaderboardClient } from "@/components/citizen/leaderboard-client";

const TOP_N = 20;

export default async function LeaderboardPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const supabase = await createClient();
  const { data: top } = await supabase
    .from("profiles")
    .select("id, full_name, points")
    .eq("role", "citizen")
    .gt("points", 0)
    .order("points", { ascending: false })
    .limit(TOP_N);

  const entries = top ?? [];
  const inTopN = entries.some((p) => p.id === profile.id);

  // If the citizen has points but didn't make the visible top N, still
  // show them where they actually rank rather than nothing — a citizen
  // checking their own standing is the point of this page. Gated on
  // actually being a citizen: an officer/admin account can accumulate
  // points too (the award trigger fires on any issue insert, regardless
  // of who filed it — e.g. from testing), and ranking them against a
  // citizens-only board produces a nonsensical "Your rank: 1" for
  // someone who was never a candidate for that board at all.
  let myRank: number | null = null;
  if (profile.role === "citizen" && !inTopN && profile.points > 0) {
    const { count } = await supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("role", "citizen")
      .gt("points", profile.points);
    myRank = (count ?? 0) + 1;
  }

  return (
    <LeaderboardClient
      entries={entries}
      currentUserId={profile.id}
      currentUserPoints={profile.points}
      currentUserRank={myRank}
    />
  );
}
