import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CATEGORY_LABELS, type IssueCategory } from "@/lib/departments";
import { computeCityStats } from "@/lib/analytics";
import { CityBriefing } from "@/components/analytics/city-briefing";

export default async function AnalyticsPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/dashboard");

  const supabase = await createClient();

  const [{ data: issues }, { data: departments }, { data: resolvedHistory }] =
    await Promise.all([
      supabase.from("issues").select("*"),
      supabase.from("departments").select("*"),
      supabase
        .from("issue_status_history")
        .select("issue_id, changed_at")
        .eq("status", "resolved"),
    ]);

  const stats = computeCityStats(issues ?? [], departments ?? [], resolvedHistory ?? []);
  const maxCategoryCount = Math.max(1, ...stats.perCategory.map(([, c]) => c));
  const maxDeptCount = Math.max(1, ...stats.perDepartment.map((d) => d.total));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">City Analytics</h1>
        <p className="text-muted-foreground">
          Aggregate view of civic issue reporting and resolution.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Total reports" value={stats.total} />
        <StatTile label="Resolution rate" value={`${stats.resolutionRate}%`} />
        <StatTile label="Critical open" value={stats.critical} tone="critical" />
        <StatTile label="Avg severity" value={stats.avgSeverity} />
      </div>

      <CityBriefing />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">By department</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {stats.perDepartment.map((d) => (
              <div key={d.name} className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{d.name}</span>
                  <span className="text-muted-foreground">
                    {d.total} total · {d.open} open ·{" "}
                    {d.avgHrs !== null
                      ? `${d.avgHrs.toFixed(1)}h avg resolution`
                      : "no resolutions yet"}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${(d.total / maxDeptCount) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">By category</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {stats.perCategory.map(([category, count]) => (
              <div key={category} className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">
                    {CATEGORY_LABELS[category as IssueCategory] ?? category}
                  </span>
                  <span className="text-muted-foreground">{count}</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${(count / maxCategoryCount) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "critical";
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p
          className={
            "text-3xl font-bold " +
            (tone === "critical" ? "text-red-600 dark:text-red-400" : "")
          }
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
