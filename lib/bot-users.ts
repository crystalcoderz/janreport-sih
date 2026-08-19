import { createServiceRoleClient } from "@/lib/supabase/server";

// Everything the admin "Bot users" page needs, gathered in one place so the
// page component stays a render function.
//
// This deliberately uses the service-role client. `phone` and the home
// coordinates are revoked from `authenticated` in schema.sql on purpose —
// "RLS is row-level only [...] column grants are the missing half" — so no
// signed-in user can read another resident's number from the browser. An
// admin looking at who is using the bot genuinely needs those numbers, so
// the read happens server-side, after the caller's role has been checked,
// rather than by loosening the grant for everybody.

export interface BotUser {
  profileId: string;
  phone: string;
  /** Whatever the citizen last told the bot to call them, else their profile name. */
  name: string | null;
  reportCount: number;
  lastReportAt: string | null;
  joinedAt: string;
  points: number;
}

export interface LiveConversation {
  phone: string;
  name: string | null;
  hasPhoto: boolean;
  hasLocation: boolean;
  updatedAt: string;
}

export interface BotActivityEntry {
  issueId: string;
  title: string;
  status: string;
  reporterName: string | null;
  phone: string | null;
  createdAt: string;
}

export interface BotUsageSummary {
  users: BotUser[];
  liveConversations: LiveConversation[];
  recentActivity: BotActivityEntry[];
  messagesHandled: number;
  messagesLast24h: number;
  reportsViaBot: number;
}

const RECENT_ACTIVITY_LIMIT = 25;

export async function getBotUsage(): Promise<BotUsageSummary> {
  const admin = createServiceRoleClient();

  const [profilesRes, issuesRes, sessionsRes, messagesRes, messages24hRes] =
    await Promise.all([
      // A phone number is only ever set by the WhatsApp OTP/session flow, so
      // "has a phone" is exactly "has used the bot".
      admin
        .from("profiles")
        .select("id, full_name, phone, points, created_at")
        .not("phone", "is", null)
        .order("created_at", { ascending: false }),
      admin
        .from("issues")
        .select("id, title, status, reporter_id, reporter_name, created_at")
        .order("created_at", { ascending: false }),
      admin
        .from("whatsapp_report_sessions")
        .select("phone, reporter_name, photo_mime_type, lat, updated_at")
        .order("updated_at", { ascending: false }),
      admin
        .from("whatsapp_processed_messages")
        .select("message_id", { count: "exact", head: true }),
      admin
        .from("whatsapp_processed_messages")
        .select("message_id", { count: "exact", head: true })
        .gte("processed_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
    ]);

  const profiles = profilesRes.data ?? [];
  const issues = issuesRes.data ?? [];

  const byReporter = new Map<string, typeof issues>();
  for (const issue of issues) {
    if (!issue.reporter_id) continue;
    const list = byReporter.get(issue.reporter_id) ?? [];
    list.push(issue);
    byReporter.set(issue.reporter_id, list);
  }

  const users: BotUser[] = profiles.map((p) => {
    // Already sorted newest-first by the query above.
    const theirs = byReporter.get(p.id) ?? [];
    return {
      profileId: p.id,
      phone: p.phone as string,
      // reporter_name is what they actually typed to the bot this time round;
      // full_name is usually null for a WhatsApp-provisioned account.
      name: theirs[0]?.reporter_name ?? p.full_name ?? null,
      reportCount: theirs.length,
      lastReportAt: theirs[0]?.created_at ?? null,
      joinedAt: p.created_at,
      points: p.points,
    };
  });

  users.sort((a, b) => {
    // Most recently active first; anyone who has never filed sinks to the
    // bottom rather than being interleaved by signup date.
    if (a.lastReportAt && b.lastReportAt) {
      return b.lastReportAt.localeCompare(a.lastReportAt);
    }
    if (a.lastReportAt) return -1;
    if (b.lastReportAt) return 1;
    return b.joinedAt.localeCompare(a.joinedAt);
  });

  const phoneByProfile = new Map(profiles.map((p) => [p.id, p.phone as string]));

  const recentActivity: BotActivityEntry[] = issues
    .slice(0, RECENT_ACTIVITY_LIMIT)
    .map((issue) => ({
      issueId: issue.id,
      title: issue.title,
      status: issue.status,
      reporterName: issue.reporter_name,
      phone: issue.reporter_id ? (phoneByProfile.get(issue.reporter_id) ?? null) : null,
      createdAt: issue.created_at,
    }));

  const liveConversations: LiveConversation[] = (sessionsRes.data ?? []).map((s) => ({
    phone: s.phone,
    name: s.reporter_name,
    // photo_mime_type stands in for the photo itself, which is a large base64
    // column there is no reason to pull into an admin list.
    hasPhoto: Boolean(s.photo_mime_type),
    hasLocation: s.lat !== null,
    updatedAt: s.updated_at,
  }));

  const botProfileIds = new Set(profiles.map((p) => p.id));

  return {
    users,
    liveConversations,
    recentActivity,
    messagesHandled: messagesRes.count ?? 0,
    messagesLast24h: messages24hRes.count ?? 0,
    reportsViaBot: issues.filter((i) => i.reporter_id && botProfileIds.has(i.reporter_id))
      .length,
  };
}
