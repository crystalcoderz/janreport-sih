"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { formatDistanceToNow } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { CATEGORY_LABELS, severityColor, type IssueCategory } from "@/lib/departments";
import { StatusBadge } from "@/components/issue/status-badge";
import { LazyIssueMap } from "@/components/map/lazy-issue-map";
import { isOverdue, hoursOverdue } from "@/lib/sla";
import { toCsv, downloadCsv } from "@/lib/csv";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ThumbsUp,
  Inbox,
  FolderOpen,
  AlertTriangle,
  CheckCircle2,
  Timer,
  Download,
  Search,
  MapPin,
  BadgeCheck,
  ShieldAlert,
  ChevronRight,
  UserPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import type { Database, IssueStatus } from "@/lib/supabase/types";
import type { Profile } from "@/lib/auth";

type Issue = Database["public"]["Tables"]["issues"]["Row"] & {
  departments?: { name: string } | null;
  teams?: { name: string } | null;
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

type SortKey = "priority" | "newest" | "oldest" | "upvotes";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "priority", label: "Priority" },
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "upvotes", label: "Most upvoted" },
];

type QuickFilter = "all" | "open" | "critical" | "overdue" | "unassigned" | "resolved";

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
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("priority");
  const [live, setLive] = useState(false);
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
      .subscribe((status) => setLive(status === "SUBSCRIBED"));

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Scoped by the dropdown filters only — the stat tiles count against
  // this, so toggling a tile doesn't change the numbers on the tiles.
  const scoped = useMemo(() => {
    return issues.filter((issue) => {
      if (statusFilter !== "all" && issue.status !== statusFilter) return false;
      if (departmentFilter !== "all" && issue.department_id !== departmentFilter)
        return false;
      return true;
    });
  }, [issues, statusFilter, departmentFilter]);

  const stats = useMemo(() => {
    const open = scoped.filter(
      (i) => i.status !== "resolved" && i.status !== "rejected"
    ).length;
    const critical = scoped.filter((i) => i.ai_severity >= 9).length;
    const resolved = scoped.filter((i) => i.status === "resolved").length;
    const overdue = scoped.filter(isOverdue).length;
    const unassigned = scoped.filter(
      (i) => !i.assigned_team_id && i.status !== "resolved" && i.status !== "rejected"
    ).length;
    return { open, critical, resolved, overdue, unassigned, total: scoped.length };
  }, [scoped]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = scoped.filter((issue) => {
      if (
        quickFilter === "open" &&
        (issue.status === "resolved" || issue.status === "rejected")
      )
        return false;
      if (quickFilter === "critical" && issue.ai_severity < 9) return false;
      if (quickFilter === "overdue" && !isOverdue(issue)) return false;
      if (
        quickFilter === "unassigned" &&
        (issue.assigned_team_id ||
          issue.status === "resolved" ||
          issue.status === "rejected")
      )
        return false;
      if (quickFilter === "resolved" && issue.status !== "resolved") return false;
      if (q) {
        const haystack = `${issue.title} ${issue.address ?? ""} ${
          issue.departments?.name ?? ""
        } ${CATEGORY_LABELS[issue.ai_category as IssueCategory] ?? issue.ai_category}`;
        if (!haystack.toLowerCase().includes(q)) return false;
      }
      return true;
    });

    const sorted = [...list];
    switch (sort) {
      case "priority":
        sorted.sort((a, b) => {
          const ao = hoursOverdue(a);
          const bo = hoursOverdue(b);
          if (ao !== bo) return bo - ao;
          if (a.ai_severity !== b.ai_severity) return b.ai_severity - a.ai_severity;
          return +new Date(b.created_at) - +new Date(a.created_at);
        });
        break;
      case "newest":
        sorted.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
        break;
      case "oldest":
        sorted.sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
        break;
      case "upvotes":
        sorted.sort((a, b) => b.upvote_count - a.upvote_count);
        break;
    }
    return sorted;
  }, [scoped, quickFilter, search, sort]);

  function exportCsv() {
    const csv = toCsv(
      [
        "Report ID",
        "Title",
        "Category",
        "Department",
        "Assigned crew",
        "Status",
        "Severity",
        "Severity score",
        "Overdue",
        "Hours overdue",
        "Upvotes",
        "Address",
        "Latitude",
        "Longitude",
        "Reported at",
      ],
      filtered.map((i) => [
        i.id.slice(0, 8),
        i.title,
        CATEGORY_LABELS[i.ai_category as IssueCategory] ?? i.ai_category,
        i.departments?.name ?? "Unassigned",
        i.teams?.name ?? "Unassigned",
        i.status,
        i.ai_severity_label,
        i.ai_severity,
        isOverdue(i) ? "Yes" : "No",
        hoursOverdue(i) || "",
        i.upvote_count,
        i.address ?? "",
        i.lat,
        i.lng,
        new Date(i.created_at).toISOString(),
      ])
    );
    downloadCsv(`janreport-issues-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    toast.success(`Exported ${filtered.length} issues`);
  }

  const toggleQuick = (f: QuickFilter) =>
    setQuickFilter((current) => (current === f ? "all" : f));

  const filtersActive =
    search !== "" || quickFilter !== "all" || statusFilter !== "all";

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <h1 className="text-3xl font-bold tracking-tight">Officer Dashboard</h1>
            <span
              className={
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium " +
                (live
                  ? "bg-green-500/10 text-green-700 dark:text-green-400"
                  : "bg-muted text-muted-foreground")
              }
            >
              <span
                className={
                  "size-1.5 rounded-full " +
                  (live ? "animate-pulse bg-green-500" : "bg-muted-foreground/50")
                }
              />
              {live ? "Live" : "Connecting"}
            </span>
          </div>
          <p className="text-muted-foreground">
            Every citizen report, prioritised by urgency and SLA breach.
          </p>
        </div>
        <Button variant="outline" onClick={exportCsv} className="shadow-sm">
          <Download className="size-4" />
          Export CSV
        </Button>
      </div>

      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatTile
          label="Total reports"
          value={stats.total}
          icon={Inbox}
          active={quickFilter === "all"}
          onClick={() => setQuickFilter("all")}
        />
        <StatTile
          label="Open"
          value={stats.open}
          icon={FolderOpen}
          tone="info"
          active={quickFilter === "open"}
          onClick={() => toggleQuick("open")}
        />
        <StatTile
          label="Critical"
          value={stats.critical}
          icon={AlertTriangle}
          tone="critical"
          active={quickFilter === "critical"}
          onClick={() => toggleQuick("critical")}
        />
        <StatTile
          label="Overdue"
          value={stats.overdue}
          icon={Timer}
          tone="warning"
          active={quickFilter === "overdue"}
          onClick={() => toggleQuick("overdue")}
        />
        <StatTile
          label="Unassigned"
          value={stats.unassigned}
          icon={UserPlus}
          tone="info"
          active={quickFilter === "unassigned"}
          onClick={() => toggleQuick("unassigned")}
        />
        <StatTile
          label="Resolved"
          value={stats.resolved}
          icon={CheckCircle2}
          tone="good"
          active={quickFilter === "resolved"}
          onClick={() => toggleQuick("resolved")}
        />
      </div>

      {/* Toolbar */}
      <div className="rounded-xl border bg-card p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-64 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by title, address, department…"
              className="h-10 border-0 bg-muted/50 pl-9 focus-visible:bg-background"
            />
          </div>

          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as IssueStatus | "all")}
          >
            <SelectTrigger className="h-10 w-40">
              <SelectValue>
                {(v) => STATUS_OPTIONS.find((o) => o.value === v)?.label ?? v}
              </SelectValue>
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
              <SelectTrigger className="h-10 w-52">
                <SelectValue>
                  {(v) =>
                    v === "all"
                      ? "All departments"
                      : (departments.find((d) => d.id === v)?.name ?? v)
                  }
                </SelectValue>
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

          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger className="h-10 w-40">
              <SelectValue>
                {(v) => SORT_OPTIONS.find((o) => o.value === v)?.label ?? v}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* List / Map */}
      <Tabs defaultValue="list" className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="list">List</TabsTrigger>
            <TabsTrigger value="map">Map</TabsTrigger>
          </TabsList>
          <p className="text-sm text-muted-foreground">
            Showing <span className="font-medium text-foreground">{filtered.length}</span>{" "}
            of {issues.length}
          </p>
        </div>

        <TabsContent value="list" className="space-y-3">
          {filtered.length === 0 ? (
            <EmptyState
              filtersActive={filtersActive}
              onClear={() => {
                setSearch("");
                setQuickFilter("all");
                setStatusFilter("all");
              }}
            />
          ) : (
            filtered.map((issue) => <IssueRow key={issue.id} issue={issue} />)
          )}
        </TabsContent>

        <TabsContent value="map">
          <div className="overflow-hidden rounded-xl border shadow-sm">
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
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

const TONE_STYLES = {
  neutral: { icon: "text-slate-600 dark:text-slate-300", chip: "bg-slate-500/10", value: "" },
  info: { icon: "text-blue-600 dark:text-blue-400", chip: "bg-blue-500/10", value: "" },
  critical: {
    icon: "text-red-600 dark:text-red-400",
    chip: "bg-red-500/10",
    value: "text-red-600 dark:text-red-400",
  },
  warning: {
    icon: "text-amber-600 dark:text-amber-400",
    chip: "bg-amber-500/10",
    value: "text-amber-600 dark:text-amber-400",
  },
  good: {
    icon: "text-green-600 dark:text-green-400",
    chip: "bg-green-500/10",
    value: "text-green-600 dark:text-green-400",
  },
} as const;

function StatTile({
  label,
  value,
  icon: Icon,
  tone = "neutral",
  active,
  onClick,
}: {
  label: string;
  value: number;
  icon: typeof Inbox;
  tone?: keyof typeof TONE_STYLES;
  active?: boolean;
  onClick?: () => void;
}) {
  const s = TONE_STYLES[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "group relative overflow-hidden rounded-xl border bg-card p-5 text-left shadow-sm transition-all " +
        "hover:-translate-y-0.5 hover:shadow-md " +
        (active ? "border-primary/60 ring-2 ring-primary/20" : "hover:border-primary/30")
      }
    >
      <div className="flex items-start justify-between gap-2">
        <div className={"flex size-10 items-center justify-center rounded-lg " + s.chip}>
          <Icon className={"size-5 " + s.icon} />
        </div>
        {active && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-primary uppercase">
            Filtered
          </span>
        )}
      </div>
      <p className={"mt-4 text-4xl font-bold tracking-tight tabular-nums " + s.value}>
        {value}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
    </button>
  );
}

function EmptyState({
  filtersActive,
  onClear,
}: {
  filtersActive: boolean;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed bg-card/50 py-20 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-muted">
        <Inbox className="size-6 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <p className="text-lg font-semibold">
          {filtersActive ? "No matching issues" : "No reports yet"}
        </p>
        <p className="max-w-sm text-sm text-muted-foreground">
          {filtersActive
            ? "Nothing matches your current search and filters."
            : "New citizen reports appear here the moment they're filed — no refresh needed."}
        </p>
      </div>
      {filtersActive && (
        <Button variant="outline" size="sm" onClick={onClear}>
          Clear filters
        </Button>
      )}
    </div>
  );
}

function IssueRow({ issue }: { issue: Issue }) {
  const overdue = isOverdue(issue);
  const overdueBy = hoursOverdue(issue);
  const accent = severityColor(issue.ai_severity);

  return (
    <Link href={`/dashboard/${issue.id}`} className="group block">
      <div className="relative flex items-center gap-4 overflow-hidden rounded-xl border bg-card p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md">
        {/* Severity accent rail */}
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-1"
          style={{ backgroundColor: accent }}
        />

        <Image
          src={issue.photo_url}
          alt=""
          width={80}
          height={80}
          unoptimized
          className="ml-1 size-16 shrink-0 rounded-lg object-cover ring-1 ring-black/5"
        />

        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-semibold group-hover:text-primary">
              {issue.title}
            </p>
            <StatusBadge status={issue.status} />
            {overdue && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                <Timer className="size-3" />
                {overdueBy}h overdue
              </span>
            )}
            {issue.resolution_verdict === "verified" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
                <BadgeCheck className="size-3" />
                AI-verified
              </span>
            )}
            {issue.resolution_verdict === "not_fixed" && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-400">
                <ShieldAlert className="size-3" />
                Not fixed
              </span>
            )}
          </div>

          <p className="truncate text-sm text-muted-foreground">
            {issue.departments?.name ?? "Unassigned"} ·{" "}
            {CATEGORY_LABELS[issue.ai_category as IssueCategory] ?? issue.ai_category} ·{" "}
            {formatDistanceToNow(new Date(issue.created_at), { addSuffix: true })}
          </p>

          <p className="flex items-center gap-1 text-xs">
            <Users className="size-3 shrink-0 text-muted-foreground" />
            {issue.teams?.name ? (
              <span className="font-medium text-foreground">{issue.teams.name}</span>
            ) : (
              <span className="text-muted-foreground/70">No crew assigned</span>
            )}
          </p>

          {issue.address && (
            <p className="flex items-center gap-1 truncate text-xs text-muted-foreground/80">
              <MapPin className="size-3 shrink-0" />
              <span className="truncate">{issue.address}</span>
            </p>
          )}
        </div>

        {/* Severity + upvotes */}
        <div className="flex shrink-0 items-center gap-5 pr-1">
          <div className="text-right">
            <div className="flex items-baseline justify-end gap-1">
              <span
                className="text-2xl font-bold tabular-nums"
                style={{ color: accent }}
              >
                {issue.ai_severity}
              </span>
              <span className="text-xs text-muted-foreground">/10</span>
            </div>
            <p className="text-xs font-medium" style={{ color: accent }}>
              {issue.ai_severity_label}
            </p>
          </div>

          <div className="hidden flex-col items-center gap-0.5 sm:flex">
            <ThumbsUp className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium tabular-nums">
              {issue.upvote_count}
            </span>
          </div>

          <ChevronRight className="size-5 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
        </div>
      </div>
    </Link>
  );
}
