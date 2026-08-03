"use client";

import dynamic from "next/dynamic";

export const LazyIssueMap = dynamic(
  () => import("./issue-map").then((m) => m.IssueMap),
  {
    ssr: false,
    loading: () => (
      <div className="h-[420px] w-full animate-pulse rounded-lg bg-muted" />
    ),
  }
);
