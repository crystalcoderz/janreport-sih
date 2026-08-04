"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { formatDistanceToNow } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { CATEGORY_LABELS, type IssueCategory } from "@/lib/departments";
import { SeverityBadge } from "@/components/issue/severity-badge";
import { StatusBadge } from "@/components/issue/status-badge";
import { LazyIssueMap } from "@/components/map/lazy-issue-map";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import type { Database, IssueStatus } from "@/lib/supabase/types";
import type { Profile } from "@/lib/auth";

type Issue = Database["public"]["Tables"]["issues"]["Row"] & {
  departments?: { name: string } | null;
};
type Department = Database["public"]["Tables"]["departments"]["Row"];

const STATUS_OPTIONS: { value: IssueStatus | "all"; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "reported", label: "Reported" },
  { value: "acknowledged", label: "Acknowledged" },
  { value: "in_progress", label: "In Progress" },
  { value: "resolved", label: "Resolved" },
  { value: "rejected", label: "Rejected" },
];

export function DashboardClient({
  initialIssues,
  departments,
  profile,
}: {
  initialIssues: Issue[];
  departments: Department[];
  profile: Profile;
}) {
  const [issues, setIssues] = useState<Issue[]>(initialIssues);
  const [statusFilter, setStatusFilter] = useState<IssueStatus | "all">("all");
  const [departmentFilter, setDepartmentFilter] = useState<string>(
    profile.role === "officer" && profile.department_id
      ? profile.department_id
      : "all"
  );

  useEffect(() => {
    const supabase = createClient();
    // Unique per effect invocation — see use-issue-notifications.ts for why
    // (Strict Mode dev double-invoke + supabase-js channel topic reuse).
    const channel = supabase
      .channel(`dashboard-issues-${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "issues" },
        (payload) => {
          const newIssue = payload.new as Issue;
          setIssues((prev) => [newIssue, ...prev]);
          toast.info(`New report: ${newIssue.title}`);
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "issues" },
        (payload) => {
          const updated = payload.new as Issue;
          setIssues((prev) =>
            prev.map((issue) =>
              issue.id === updated.id ? { ...issue, ...updated } : issue
            )
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const filtered = useMemo(() => {
    return issues.filter((issue) => {
      if (statusFilter !== "all" && issue.status !== statusFilter) return false;
      if (departmentFilter !== "all" && issue.department_id !== departmentFilter)
        return false;
      return true;
    });
  }, [issues, statusFilter, departmentFilter]);

  const stats = useMemo(() => {
    const open = filtered.filter(
      (i) => i.status !== "resolved" && i.status !== "rejected"
    ).length;
    const critical = filtered.filter((i) => i.ai_severity >= 9).length;
    const resolved = filtered.filter((i) => i.status === "resolved").length;
    return { open, critical, resolved, total: filtered.length };
  }, [filtered]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Officer Dashboard</h1>
        <p className="text-muted-foreground">
          Live view of reported civic issues — updates in real time.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Total" value={stats.total} />
        <StatTile label="Open" value={stats.open} />
        <StatTile label="Critical" value={stats.critical} tone="critical" />
        <StatTile label="Resolved" value={stats.resolved} tone="good" />
      </div>

      <div className="flex flex-wrap gap-3">
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as IssueStatus | "all")}
        >
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {profile.role === "admin" && (
          <Select
            value={departmentFilter}
            onValueChange={(v) => setDepartmentFilter(v ?? "all")}
          >
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list">List</TabsTrigger>
          <TabsTrigger value="map">Map</TabsTrigger>
        </TabsList>
        <TabsContent value="list" className="flex flex-col gap-3">
          {filtered.length === 0 && (
            <p className="py-12 text-center text-muted-foreground">
              No issues match these filters.
            </p>
          )}
          {filtered.map((issue) => (
            <IssueRow key={issue.id} issue={issue} />
          ))}
        </TabsContent>
        <TabsContent value="map">
          <LazyIssueMap
            issues={filtered}
            renderPopup={(issue) => (
              <div className="flex flex-col gap-1">
                <span className="font-medium">{issue.title}</span>
                <Link
                  href={`/dashboard/${issue.id}`}
                  className="text-sm text-primary underline"
                >
                  View details
                </Link>
              </div>
            )}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "critical" | "good";
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p
          className={
            "text-3xl font-bold " +
            (tone === "critical"
              ? "text-red-600 dark:text-red-400"
              : tone === "good"
                ? "text-green-600 dark:text-green-400"
                : "")
          }
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function IssueRow({ issue }: { issue: Issue }) {
  return (
    <Link href={`/dashboard/${issue.id}`}>
      <Card className="transition-colors hover:bg-muted/50">
        <CardContent className="flex items-center gap-4 pt-6">
          <Image
            src={issue.photo_url}
            alt={issue.title}
            width={64}
            height={64}
            unoptimized
            className="size-16 shrink-0 rounded-md object-cover"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate font-medium">{issue.title}</p>
              <StatusBadge status={issue.status} />
            </div>
            <p className="truncate text-sm text-muted-foreground">
              {issue.departments?.name ?? "Unassigned"} ·{" "}
              {CATEGORY_LABELS[issue.ai_category as IssueCategory] ??
                issue.ai_category}{" "}
              ·{" "}
              {formatDistanceToNow(new Date(issue.created_at), {
                addSuffix: true,
              })}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <SeverityBadge severity={issue.ai_severity} />
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <ThumbsUp className="size-3" />
              {issue.upvote_count}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
