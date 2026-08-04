import type { SupabaseClient } from "@supabase/supabase-js";
import { CATEGORY_LABELS, type IssueCategory } from "@/lib/departments";
import { computeCityStats } from "@/lib/analytics";
import { haversineDistanceMeters } from "@/lib/geo";
import type { Database, IssueStatus } from "@/lib/supabase/types";

// Read-only tools for the citizen help chatbot (lib/kimi/agent.ts). Two
// rules keep this safe to hand to an LLM:
//
// 1. `userId` is a plain function argument closed over by the route that
//    calls executeTool — it is NEVER part of a tool's JSON schema, so
//    there is no parameter an LLM (or a prompt-injection attempt inside
//    a message) could set to impersonate a different citizen.
// 2. Every query still runs through the request's RLS-scoped Supabase
//    client, so even a bug here is caught by the same policies that
//    protect the REST API — this is defense in depth, not the only
//    layer.

export interface ToolContext {
  userId: string;
  supabase: SupabaseClient<Database>;
}

// OpenAI/Kimi function-calling tool definitions.
export const TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "get_my_reports",
      description:
        "Look up the civic issues the current citizen has personally reported, optionally filtered by status. Use this whenever they ask about 'my report(s)' or the status of something they filed.",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["reported", "acknowledged", "in_progress", "resolved", "rejected"],
            description: "Optional status filter.",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_issue_details",
      description:
        "Get full details (status, timeline, resolution verdict) for one specific issue by its ID. Issue IDs look like UUIDs and normally come from a prior get_my_reports or find_nearby_issues call.",
      parameters: {
        type: "object",
        properties: {
          issueId: { type: "string", description: "The issue's UUID." },
        },
        required: ["issueId"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "find_nearby_issues",
      description:
        "Find recently reported civic issues near a given latitude/longitude. Use when the citizen asks what's been reported near them or in an area.",
      parameters: {
        type: "object",
        properties: {
          lat: { type: "number", description: "Latitude." },
          lng: { type: "number", description: "Longitude." },
          radiusMeters: {
            type: "number",
            description: "Search radius in meters. Defaults to 1000 (1km).",
          },
        },
        required: ["lat", "lng"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_city_stats",
      description:
        "Get aggregate city-wide stats: total reports, resolution rate, and per-department/per-category breakdowns. Use for questions like 'how many potholes have been reported' or 'which department is slowest'.",
      parameters: { type: "object", properties: {} },
    },
  },
] as const;

async function getMyReports(ctx: ToolContext, args: { status?: IssueStatus }) {
  let query = ctx.supabase
    .from("issues")
    .select("id, title, ai_category, status, ai_severity, created_at, departments(name)")
    .eq("reporter_id", ctx.userId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (args.status) query = query.eq("status", args.status);

  const { data, error } = await query;
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { reports: [], note: "No reports found." };

  return {
    reports: data.map((r) => ({
      id: r.id,
      title: r.title,
      category: CATEGORY_LABELS[r.ai_category as IssueCategory] ?? r.ai_category,
      status: r.status,
      severity: r.ai_severity,
      department: (r as { departments?: { name: string } | null }).departments?.name ?? null,
      reportedAt: r.created_at,
    })),
  };
}

async function getIssueDetails(ctx: ToolContext, args: { issueId: string }) {
  const [{ data: issue, error }, { data: history }] = await Promise.all([
    ctx.supabase
      .from("issues")
      .select("*, departments(name)")
      .eq("id", args.issueId)
      .single(),
    ctx.supabase
      .from("issue_status_history")
      .select("status, note, changed_at")
      .eq("issue_id", args.issueId)
      .order("changed_at", { ascending: true }),
  ]);

  if (error || !issue) return { error: "Issue not found." };

  return {
    id: issue.id,
    title: issue.title,
    description: issue.description,
    category: CATEGORY_LABELS[issue.ai_category as IssueCategory] ?? issue.ai_category,
    severity: issue.ai_severity,
    status: issue.status,
    department: issue.departments?.name ?? null,
    address: issue.address,
    upvotes: issue.upvote_count,
    resolutionVerdict: issue.resolution_verdict,
    resolutionVerdictReason: issue.resolution_verdict_reason,
    timeline: history ?? [],
  };
}

async function findNearbyIssues(
  ctx: ToolContext,
  args: { lat: number; lng: number; radiusMeters?: number }
) {
  const radius = args.radiusMeters ?? 1000;
  // No PostGIS RPC for "any category, any status" nearby search exists
  // yet, so fetch a bounded recent window and filter in JS — fine at
  // this scale and avoids a schema change for a chatbot convenience tool.
  const { data, error } = await ctx.supabase
    .from("issues")
    .select("id, title, ai_category, status, ai_severity, lat, lng, address, created_at")
    .order("created_at", { ascending: false })
    .limit(300);

  if (error) return { error: error.message };

  const nearby = (data ?? [])
    .map((i) => ({
      ...i,
      distanceMeters: Math.round(
        haversineDistanceMeters({ lat: args.lat, lng: args.lng }, { lat: i.lat, lng: i.lng })
      ),
    }))
    .filter((i) => i.distanceMeters <= radius)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, 15);

  return {
    issues: nearby.map((i) => ({
      id: i.id,
      title: i.title,
      category: CATEGORY_LABELS[i.ai_category as IssueCategory] ?? i.ai_category,
      status: i.status,
      severity: i.ai_severity,
      address: i.address,
      distanceMeters: i.distanceMeters,
    })),
  };
}

async function getCityStats(ctx: ToolContext) {
  const [{ data: issues }, { data: departments }, { data: resolvedHistory }] =
    await Promise.all([
      ctx.supabase.from("issues").select("*"),
      ctx.supabase.from("departments").select("*"),
      ctx.supabase
        .from("issue_status_history")
        .select("issue_id, changed_at")
        .eq("status", "resolved"),
    ]);

  const stats = computeCityStats(issues ?? [], departments ?? [], resolvedHistory ?? []);
  return {
    total: stats.total,
    resolutionRate: stats.resolutionRate,
    avgSeverity: stats.avgSeverity,
    byDepartment: stats.perDepartment,
    byCategory: stats.perCategory.map(([category, count]) => ({
      category: CATEGORY_LABELS[category as IssueCategory] ?? category,
      count,
    })),
  };
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext
): Promise<unknown> {
  switch (name) {
    case "get_my_reports":
      return getMyReports(ctx, args as { status?: IssueStatus });
    case "get_issue_details":
      return getIssueDetails(ctx, args as { issueId: string });
    case "find_nearby_issues":
      return findNearbyIssues(ctx, args as { lat: number; lng: number; radiusMeters?: number });
    case "get_city_stats":
      return getCityStats(ctx);
    default:
      return { error: `Unknown tool: ${name}` };
  }
}
