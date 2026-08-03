"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { LazyIssueMap } from "@/components/map/lazy-issue-map";
import { StatusBadge } from "@/components/issue/status-badge";
import { SeverityBadge } from "@/components/issue/severity-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { CATEGORY_LABELS, ISSUE_CATEGORIES, severityColor } from "@/lib/departments";
import type { Database } from "@/lib/supabase/types";
import { ThumbsUp } from "lucide-react";
import { toast } from "sonner";

type Issue = Database["public"]["Tables"]["issues"]["Row"] & {
  departments?: { name: string } | null;
};

export function MapPageClient({
  initialIssues,
  upvotedIssueIds,
}: {
  initialIssues: Issue[];
  upvotedIssueIds: string[];
}) {
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [heatmap, setHeatmap] = useState(false);
  const [upvoted, setUpvoted] = useState<Set<string>>(
    new Set(upvotedIssueIds)
  );
  const [counts, setCounts] = useState<Record<string, number>>(
    Object.fromEntries(initialIssues.map((i) => [i.id, i.upvote_count]))
  );

  const filtered = useMemo(() => {
    if (categoryFilter === "all") return initialIssues;
    return initialIssues.filter((i) => i.ai_category === categoryFilter);
  }, [initialIssues, categoryFilter]);

  async function toggleUpvote(issueId: string) {
    const alreadyUpvoted = upvoted.has(issueId);
    const method = alreadyUpvoted ? "DELETE" : "POST";
    const res = await fetch(`/api/issues/${issueId}/upvote`, { method });
    if (!res.ok) {
      toast.error("Please sign in to upvote.");
      return;
    }
    setUpvoted((prev) => {
      const next = new Set(prev);
      if (alreadyUpvoted) {
        next.delete(issueId);
      } else {
        next.add(issueId);
      }
      return next;
    });
    setCounts((prev) => ({
      ...prev,
      [issueId]: (prev[issueId] ?? 0) + (alreadyUpvoted ? -1 : 1),
    }));
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Live Issue Map</h1>
        <p className="text-muted-foreground">
          Every reported issue across the city, in real time. Upvote reports
          near you to raise their priority.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v ?? "all")}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {ISSUE_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant={heatmap ? "default" : "outline"}
          onClick={() => setHeatmap((v) => !v)}
        >
          {heatmap ? "Showing heatmap" : "Show heatmap"}
        </Button>
        <Legend />
      </div>

      <LazyIssueMap
        issues={filtered}
        heatmap={heatmap}
        renderPopup={(issue) => (
          <MapPopup
            issue={issue}
            upvoted={upvoted.has(issue.id)}
            count={counts[issue.id] ?? issue.upvote_count}
            onToggleUpvote={() => toggleUpvote(issue.id)}
          />
        )}
      />
    </div>
  );
}

function MapPopup({
  issue,
  upvoted,
  count,
  onToggleUpvote,
}: {
  issue: Issue;
  upvoted: boolean;
  count: number;
  onToggleUpvote: () => void;
}) {
  return (
    <div className="flex w-52 flex-col gap-2">
      <Image
        src={issue.photo_url}
        alt={issue.title}
        width={200}
        height={100}
        unoptimized
        className="h-24 w-full rounded object-cover"
      />
      <p className="font-medium leading-tight">{issue.title}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge status={issue.status} />
        <SeverityBadge severity={issue.ai_severity} />
      </div>
      <p className="text-xs text-muted-foreground">
        {issue.departments?.name ?? "Unassigned"}
      </p>
      <Button size="sm" variant={upvoted ? "secondary" : "outline"} onClick={onToggleUpvote}>
        <ThumbsUp className="size-3.5" />
        {upvoted ? "Upvoted" : "Upvote"} ({count})
      </Button>
      <Link
        href={`/issues/${issue.id}`}
        className="text-center text-xs text-primary underline underline-offset-2"
      >
        View full details
      </Link>
    </div>
  );
}

function Legend() {
  const items: Array<[string, number]> = [
    ["Critical", 9],
    ["High", 7],
    ["Moderate", 5],
    ["Low", 2],
  ];
  return (
    <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
      {items.map(([label, score]) => (
        <span key={label} className="flex items-center gap-1">
          <span
            className="size-2.5 rounded-full"
            style={{ backgroundColor: severityColor(score) }}
          />
          {label}
        </span>
      ))}
    </div>
  );
}
