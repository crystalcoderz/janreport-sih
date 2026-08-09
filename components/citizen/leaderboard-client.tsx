"use client";

import { Card, CardContent } from "@/components/ui/card";
import { useTranslation } from "@/lib/i18n/context";
import { Trophy, Medal, Award } from "lucide-react";
import { cn } from "@/lib/utils";

interface Entry {
  id: string;
  full_name: string | null;
  points: number;
}

const RANK_STYLE: Record<number, { icon: typeof Trophy; className: string }> = {
  1: { icon: Trophy, className: "text-amber-500" },
  2: { icon: Medal, className: "text-slate-400" },
  3: { icon: Award, className: "text-orange-600" },
};

export function LeaderboardClient({
  entries,
  currentUserId,
  currentUserPoints,
  currentUserRank,
}: {
  entries: Entry[];
  currentUserId: string;
  currentUserPoints: number;
  currentUserRank: number | null;
}) {
  const { t } = useTranslation();

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("leaderboard.title")}</h1>
        <p className="text-muted-foreground">{t("leaderboard.description")}</p>
      </div>

      {entries.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Trophy className="size-8 text-muted-foreground" />
            <p className="font-medium">{t("leaderboard.empty")}</p>
            <p className="text-sm text-muted-foreground">{t("leaderboard.emptyHint")}</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="divide-y p-0">
            {entries.map((entry, i) => {
              const rank = i + 1;
              const style = RANK_STYLE[rank];
              const isMe = entry.id === currentUserId;
              return (
                <div
                  key={entry.id}
                  className={cn(
                    "flex items-center gap-4 px-4 py-3",
                    isMe && "bg-primary/5"
                  )}
                >
                  <div className="flex size-8 shrink-0 items-center justify-center">
                    {style ? (
                      <style.icon className={cn("size-5", style.className)} />
                    ) : (
                      <span className="text-sm font-medium text-muted-foreground tabular-nums">
                        {rank}
                      </span>
                    )}
                  </div>
                  <p className="min-w-0 flex-1 truncate font-medium">
                    {entry.full_name || t("leaderboard.anonymousCitizen")}
                    {isMe && (
                      <span className="ml-2 text-xs font-normal text-primary">
                        {t("leaderboard.you")}
                      </span>
                    )}
                  </p>
                  <p className="shrink-0 font-semibold tabular-nums">
                    {entry.points} <span className="text-xs font-normal text-muted-foreground">{t("leaderboard.pts")}</span>
                  </p>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {currentUserRank && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex items-center gap-4 py-3">
            <div className="flex size-8 shrink-0 items-center justify-center">
              <span className="text-sm font-medium text-muted-foreground tabular-nums">
                {currentUserRank}
              </span>
            </div>
            <p className="flex-1 font-medium">{t("leaderboard.yourRank")}</p>
            <p className="font-semibold tabular-nums">
              {currentUserPoints} <span className="text-xs font-normal text-muted-foreground">{t("leaderboard.pts")}</span>
            </p>
          </CardContent>
        </Card>
      )}

      <p className="text-center text-xs text-muted-foreground">{t("leaderboard.howToEarn")}</p>
    </div>
  );
}
