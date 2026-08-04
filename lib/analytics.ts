import { CATEGORY_LABELS, type IssueCategory } from "@/lib/departments";
import type { Database } from "@/lib/supabase/types";

type Issue = Database["public"]["Tables"]["issues"]["Row"];
type Department = Database["public"]["Tables"]["departments"]["Row"];
type ResolvedHistoryRow = { issue_id: string; changed_at: string };

export interface DepartmentStat {
  name: string;
  total: number;
  open: number;
  resolved: number;
  avgHrs: number | null;
}

export interface CityStats {
  total: number;
  resolved: number;
  critical: number;
  resolutionRate: number;
  avgSeverity: string;
  perDepartment: DepartmentStat[];
  perCategory: [string, number][];
}

// Shared by the analytics page (app/(officer)/analytics/page.tsx) and the
// AI City Briefing API route (app/api/kimi/briefing/route.ts) so the
// resolution-time math only lives in one place.
export function computeCityStats(
  issues: Issue[],
  departments: Department[],
  resolvedHistory: ResolvedHistoryRow[]
): CityStats {
  const total = issues.length;
  const resolved = issues.filter((i) => i.status === "resolved").length;
  const critical = issues.filter((i) => i.ai_severity >= 9).length;
  const resolutionRate = total ? Math.round((resolved / total) * 100) : 0;
  const avgSeverity = total
    ? (issues.reduce((s, i) => s + i.ai_severity, 0) / total).toFixed(1)
    : "0";

  const resolvedAtByIssue = new Map(
    resolvedHistory.map((h) => [h.issue_id, h.changed_at])
  );

  const perDepartment: DepartmentStat[] = departments.map((dept) => {
    const deptIssues = issues.filter((i) => i.department_id === dept.id);
    const deptResolved = deptIssues.filter((i) => i.status === "resolved");
    const resolutionTimesHrs = deptResolved
      .map((i) => {
        const resolvedAt = resolvedAtByIssue.get(i.id);
        if (!resolvedAt) return null;
        return (
          (new Date(resolvedAt).getTime() - new Date(i.created_at).getTime()) /
          3_600_000
        );
      })
      .filter((v): v is number => v !== null);
    const avgHrs = resolutionTimesHrs.length
      ? resolutionTimesHrs.reduce((a, b) => a + b, 0) / resolutionTimesHrs.length
      : null;

    return {
      name: dept.name,
      total: deptIssues.length,
      open: deptIssues.filter(
        (i) => i.status !== "resolved" && i.status !== "rejected"
      ).length,
      resolved: deptResolved.length,
      avgHrs,
    };
  });

  const perCategory = Object.entries(
    issues.reduce<Record<string, number>>((acc, i) => {
      acc[i.ai_category] = (acc[i.ai_category] ?? 0) + 1;
      return acc;
    }, {})
  ).sort((a, b) => b[1] - a[1]);

  return { total, resolved, critical, resolutionRate, avgSeverity, perDepartment, perCategory };
}

// Renders CityStats as compact plain text for an LLM prompt.
export function formatCityStatsForPrompt(stats: CityStats): string {
  const deptLines = stats.perDepartment
    .map(
      (d) =>
        `- ${d.name}: ${d.total} total, ${d.open} open, ${d.resolved} resolved${
          d.avgHrs !== null ? `, avg resolution ${d.avgHrs.toFixed(1)}h` : ", no resolutions yet"
        }`
    )
    .join("\n");

  const categoryLines = stats.perCategory
    .map(
      ([category, count]) =>
        `- ${CATEGORY_LABELS[category as IssueCategory] ?? category}: ${count}`
    )
    .join("\n");

  return `City-wide totals: ${stats.total} reports, ${stats.resolutionRate}% resolution rate, ${stats.critical} critical-severity open, average severity ${stats.avgSeverity}/10.

By department:
${deptLines || "(no departments)"}

By category:
${categoryLines || "(no issues yet)"}`;
}
