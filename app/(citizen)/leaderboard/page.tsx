import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { Award, Medal, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";

const RANK_ICONS = [Trophy, Medal, Award];

export default async function LeaderboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, points")
    .eq("role", "citizen")
    .order("points", { ascending: false })
    .limit(50);

  const ranked = profiles ?? [];

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Leaderboard</h1>
        <p className="text-muted-foreground">
          Earn 5 points for every report, 15 more when it&apos;s resolved.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-col divide-y pt-6">
          {ranked.length === 0 && (
            <p className="py-8 text-center text-muted-foreground">
              No reports yet — be the first!
            </p>
          )}
          {ranked.map((p, idx) => {
            const Icon = RANK_ICONS[idx];
            const isMe = p.id === user?.id;
            return (
              <div
                key={p.id}
                className={cn(
                  "flex items-center gap-3 py-3",
                  isMe && "rounded-md bg-secondary/60 px-2"
                )}
              >
                <span className="flex w-6 shrink-0 items-center justify-center font-semibold text-muted-foreground">
                  {Icon ? (
                    <Icon
                      className={cn(
                        "size-5",
                        idx === 0 && "text-amber-500",
                        idx === 1 && "text-slate-400",
                        idx === 2 && "text-amber-700"
                      )}
                    />
                  ) : (
                    idx + 1
                  )}
                </span>
                <span className="flex-1 truncate font-medium">
                  {p.full_name ?? "Anonymous"} {isMe && "(you)"}
                </span>
                <span className="font-semibold">{p.points} pts</span>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
