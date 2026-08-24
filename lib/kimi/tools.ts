import type { SupabaseClient } from "@supabase/supabase-js";
import { CATEGORY_LABELS, type IssueCategory } from "@/lib/departments";
import { computeCityStats } from "@/lib/analytics";
import { haversineDistanceMeters } from "@/lib/geo";
import {
  finalizeReportIfReady,
  saveAddressToSession,
  saveReporterNameToSession,
  clearReportSession,
} from "@/lib/whatsapp/report";
import { createWhatsAppSessionLink } from "@/lib/whatsapp/session-link";
import type { Database, IssueStatus } from "@/lib/supabase/types";

// Tools for the citizen help chatbot (lib/kimi/agent.ts) — used by both
// the web help widget and the WhatsApp bot. Two rules keep this safe to
// hand to an LLM:
//
// 1. `userId` (and `phone`, for the WhatsApp-only tools) are plain
//    function arguments closed over by the route that calls executeTool —
//    NEVER part of a tool's JSON schema, so there is no parameter an LLM
//    (or a prompt-injection attempt inside a message) could set to
//    impersonate a different citizen or file a report against another
//    phone's session.
// 2. Every query still runs through the request's RLS-scoped Supabase
//    client (or, for WhatsApp where there's no citizen session to scope
//    RLS to, the service-role client — `userId`/`phone` remain the sole
//    scoping mechanism either way), so even a bug here is caught by the
//    same policies that protect the REST API — this is defense in depth,
//    not the only layer.

export interface ToolContext {
  userId: string;
  supabase: SupabaseClient<Database>;
  // Only set when this context belongs to a WhatsApp conversation — gates
  // the file_new_report/upvote-instead flow, which needs a phone-keyed
  // report session and has no meaning for the web chat widget.
  phone?: string;
}

// OpenAI/Kimi function-calling tool definitions. Shared read-only tools
// (safe for the web help chat and WhatsApp alike).
export const BASE_TOOL_DEFINITIONS = [
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

// WhatsApp-only write tools — kept out of BASE_TOOL_DEFINITIONS so the web
// help chat's model never even sees them as an option (it has no phone-keyed
// report session for file_new_report to act on).
export const WHATSAPP_TOOL_DEFINITIONS = [
  ...BASE_TOOL_DEFINITIONS,
  {
    type: "function" as const,
    function: {
      name: "file_new_report",
      description:
        "WhatsApp only. Files a civic issue report using the photo and location the citizen has already sent in this conversation — you never pass the photo/location yourself, it reads whatever is already attached to this chat. Call this once you believe you have both a photo and a location (if not, it tells you what's still missing so you can ask). Before filing, it automatically checks for very similar open reports already nearby: if it finds one, it returns those as `duplicates` instead of filing — ask the citizen if that's the same issue, and if they confirm, call this again with forceNew: false and upvote using upvote_existing_report instead; if they say it's different, call this again with forceNew: true to file anyway.",
      parameters: {
        type: "object",
        properties: {
          forceNew: {
            type: "boolean",
            description:
              "Set true to skip the duplicate check and file as a new report — only after the citizen has confirmed a previously-returned duplicate is NOT the same issue.",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "set_location_by_address",
      description:
        "WhatsApp only. Use when the citizen isn't physically at the issue right now (reporting from an older photo, or their GPS/location sharing isn't working) and instead describes where it is in words — a street, area, landmark, or city. Resolves that description to a map location and saves it as this chat's report location, exactly as if they'd shared GPS. Read back the resolved address to the citizen before filing, since geocoding a vague description can land in the wrong place — if it looks wrong, ask them to be more specific and call this again.",
      parameters: {
        type: "object",
        properties: {
          address: {
            type: "string",
            description:
              "The location description the citizen gave, as close to their own words as possible — include any landmark/area/city they mentioned.",
          },
        },
        required: ["address"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "set_reporter_name",
      description:
        "WhatsApp only. Saves the citizen's name against the report currently being filed in this chat. A name is required before file_new_report will succeed, even if the citizen has reported before — ask for it fresh every time (they may be reporting on someone else's behalf), and call this as soon as they give it.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "The citizen's name, as they gave it.",
          },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_report_link",
      description:
        "WhatsApp only. Generates a one-time link that opens the web portal already signed in as this citizen, showing full photos, the status timeline, and (once resolved) the AI verdict — richer than what fits in a chat reply. Use when the citizen wants to 'see' a report, view it in the browser, or asks for a link. Pass issueId to link straight to one specific report; omit it to link to their full My Reports list. The link is single-use and expires quickly, so generate a fresh one each time rather than reusing an old one from earlier in the conversation.",
      parameters: {
        type: "object",
        properties: {
          issueId: {
            type: "string",
            description: "UUID of a specific issue to link to. Omit to link to the citizen's full My Reports list instead.",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "upvote_existing_report",
      description:
        "WhatsApp only. Adds the citizen's vote to an existing issue instead of filing a duplicate — use after they confirm a report returned by file_new_report's duplicates list is the same issue they're seeing.",
      parameters: {
        type: "object",
        properties: {
          issueId: { type: "string", description: "The existing issue's UUID." },
        },
        required: ["issueId"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "cancel_report",
      description:
        "WhatsApp only. Discards the photo/location/note the citizen has sent so far in this chat, so they can start a new report from scratch. Use when they say things like 'cancel', 'never mind', 'start over', or 'forget that' about the report they were in the middle of filing.",
      parameters: { type: "object", properties: {} },
    },
  },
] as const;

const MY_REPORTS_LIMIT = 20;

async function getMyReports(ctx: ToolContext, args: { status?: IssueStatus }) {
  let query = ctx.supabase
    .from("issues")
    .select("id, title, ai_category, status, ai_severity, created_at, departments(name)")
    .eq("reporter_id", ctx.userId)
    .order("created_at", { ascending: false })
    .limit(MY_REPORTS_LIMIT);

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
    // Tells the agent there may be older reports it isn't seeing, so it
    // doesn't conclude "no report about X" from a truncated window —
    // it should narrow by status or ask the citizen which report they mean.
    truncated: data.length >= MY_REPORTS_LIMIT,
  };
}

async function getIssueDetails(ctx: ToolContext, args: { issueId: string }) {
  const [
    { data: issue, error: issueError },
    { data: history, error: historyError },
  ] = await Promise.all([
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

  if (issueError || !issue) return { error: "Issue not found." };
  // Don't silently present an incomplete timeline as the whole history —
  // let the agent tell the citizen the lookup partially failed instead of
  // stating "no status updates yet" when that's just a fetch error.
  if (historyError) {
    return { error: "Could not load this issue's status history right now." };
  }

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
    photoUrl: issue.photo_url,
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
  const [
    { data: issues, error: issuesError },
    { data: departments, error: deptError },
    { data: resolvedHistory, error: historyError },
  ] = await Promise.all([
    ctx.supabase.from("issues").select("*"),
    ctx.supabase.from("departments").select("*"),
    ctx.supabase
      .from("issue_status_history")
      .select("issue_id, changed_at")
      .eq("status", "resolved"),
  ]);

  // A partial failure here (e.g. issues loads, departments doesn't) would
  // otherwise silently compute stats from an empty array and hand the
  // agent a confident-looking "0 reports" answer instead of an error.
  if (issuesError || deptError || historyError) {
    return { error: "Could not load city stats right now." };
  }

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

async function fileNewReport(ctx: ToolContext, args: { forceNew?: boolean }) {
  if (!ctx.phone) return { error: "file_new_report is only available on WhatsApp." };

  const result = await finalizeReportIfReady(ctx.phone, { forceNew: args.forceNew });

  switch (result.status) {
    case "incomplete":
      return {
        filed: false,
        reason: "missing_photo_or_location_or_name",
        hasPhoto: result.hasPhoto,
        hasLocation: result.hasLocation,
        hasName: result.hasName,
      };
    case "duplicates":
      return {
        filed: false,
        reason: "possible_duplicates",
        category: result.category,
        severity: result.severity,
        duplicates: result.duplicates,
      };
    case "error":
      return { filed: false, reason: "error", message: result.message };
    case "filed":
      return { filed: true, issue: result.issue };
    // The junk screen rejecting the photo is an ordinary outcome, not an
    // error. Without this arm the function fell off the end and returned
    // undefined, which JSON.stringify renders as nothing at all -- so the
    // tool message had no content and the whole turn failed, leaving the
    // citizen with silence instead of "that photo doesn't show a civic issue".
    case "not_an_issue":
      return { filed: false, reason: "not_a_civic_issue", description: result.description };
    default: {
      // Exhaustiveness guard: a new FinalizeReportResult variant becomes a
      // type error here rather than another silent undefined.
      const unreachable: never = result;
      console.error("fileNewReport: unhandled finalize result", unreachable);
      return { filed: false, reason: "error", message: "Could not file the report." };
    }
  }
}

async function setLocationByAddress(ctx: ToolContext, args: { address: string }) {
  if (!ctx.phone) return { error: "set_location_by_address is only available on WhatsApp." };
  if (!args.address?.trim()) return { error: "address is required." };

  const result = await saveAddressToSession(ctx.phone, args.address.trim());
  if (!result.ok) return { resolved: false, reason: result.error };
  return { resolved: true, formattedAddress: result.formattedAddress, mapsLink: result.mapsLink };
}

async function setReporterName(ctx: ToolContext, args: { name: string }) {
  if (!ctx.phone) return { error: "set_reporter_name is only available on WhatsApp." };
  if (!args.name?.trim()) return { error: "name is required." };

  await saveReporterNameToSession(ctx.phone, args.name.trim());
  return { saved: true };
}

async function getReportLink(ctx: ToolContext, args: { issueId?: string }) {
  if (!ctx.phone) return { error: "get_report_link is only available on WhatsApp." };

  const redirectPath = args.issueId ? `/issues/${args.issueId}` : "/my-reports";
  const link = await createWhatsAppSessionLink(ctx.phone, redirectPath);
  if (!link) return { error: "Could not create a link right now. Please try again." };
  return { link };
}

async function upvoteExistingReport(ctx: ToolContext, args: { issueId: string }) {
  if (!ctx.phone) return { error: "upvote_existing_report is only available on WhatsApp." };
  if (!args.issueId) return { error: "issueId is required." };

  const { error } = await ctx.supabase
    .from("issue_upvotes")
    .insert({ issue_id: args.issueId, user_id: ctx.userId });

  // 23505 = unique_violation — already upvoted, treat as success.
  if (error && error.code !== "23505") return { error: error.message };
  return { upvoted: true };
}

async function cancelReport(ctx: ToolContext) {
  if (!ctx.phone) return { error: "cancel_report is only available on WhatsApp." };
  await clearReportSession(ctx.phone);
  return { cancelled: true };
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
    case "file_new_report":
      return fileNewReport(ctx, args as { forceNew?: boolean });
    case "set_location_by_address":
      return setLocationByAddress(ctx, args as { address: string });
    case "set_reporter_name":
      return setReporterName(ctx, args as { name: string });
    case "get_report_link":
      return getReportLink(ctx, args as { issueId?: string });
    case "upvote_existing_report":
      return upvoteExistingReport(ctx, args as { issueId: string });
    case "cancel_report":
      return cancelReport(ctx);
    default:
      return { error: `Unknown tool: ${name}` };
  }
}
