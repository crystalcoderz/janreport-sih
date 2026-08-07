"use client";

import dynamic from "next/dynamic";
import type { Database } from "@/lib/supabase/types";

// Reuses the same map component (and therefore the same Google→OSM
// fallback) as the dashboard/citizen maps, pinned to a single issue.
const LazyIssueMap = dynamic(
  () => import("./issue-map").then((m) => m.IssueMap),
  {
    ssr: false,
    loading: () => <div className="h-56 w-full animate-pulse rounded-lg bg-muted" />,
  }
);

type Issue = Database["public"]["Tables"]["issues"]["Row"];

export function IssueLocationMap({ issue }: { issue: Issue }) {
  return (
    <LazyIssueMap
      issues={[issue]}
      center={[issue.lat, issue.lng]}
      zoom={16}
      height="220px"
      renderPopup={(i) => <span className="font-medium">{i.title}</span>}
    />
  );
}
