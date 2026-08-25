import { createServiceRoleClient } from "@/lib/supabase/server";
import { haversineKm } from "@/lib/municipal-directory";

// The record of what JanReport actually said to a municipal body, and what it
// said back.
//
// Until now the complaint went out and left nothing behind but a console line,
// so an officer looking at a report could not tell whether the nagar nigam had
// been written to at all, let alone what was sent or whether anyone replied.
// The reply fared slightly better -- it landed as a note on the timeline --
// but mixed in with status changes and with no sign of the message that
// prompted it.
//
// Stored service-role only, like every other table holding an address: the
// pages that show it check the reader is an officer or admin first.

export type MailDirection = "outbound" | "inbound";

export interface MunicipalMail {
  id: number;
  issueId: string;
  direction: MailDirection;
  /** Recipient for outbound, sender for inbound. */
  address: string;
  subject: string | null;
  body: string | null;
  /** The letter as it was actually sent, or the reply as it arrived. */
  bodyHtml: string | null;
  officeName: string | null;
  createdAt: string;
}

interface Row {
  id: number;
  issue_id: string;
  direction: MailDirection;
  address: string;
  subject: string | null;
  body: string | null;
  body_html: string | null;
  office_name: string | null;
  created_at: string;
}

function toMail(r: Row): MunicipalMail {
  return {
    id: r.id,
    issueId: r.issue_id,
    direction: r.direction,
    address: r.address,
    subject: r.subject,
    body: r.body,
    bodyHtml: r.body_html,
    officeName: r.office_name,
    createdAt: r.created_at,
  };
}

/**
 * Record one message, in either direction.
 *
 * Best-effort: the mail has already been sent (or already relayed) by the time
 * this runs, and failing to file a copy must not turn a delivered complaint
 * into an error.
 */
export async function recordMunicipalMail(params: {
  issueId: string;
  direction: MailDirection;
  address: string;
  subject?: string | null;
  body?: string | null;
  officeName?: string | null;
  providerMessageId?: string | null;
  /**
   * The HTML actually sent or received. Stored rather than re-rendered later,
   * so the record shows what the office really got instead of what today's
   * template would produce.
   */
  bodyHtml?: string | null;
}): Promise<void> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("municipal_emails").insert({
    issue_id: params.issueId,
    direction: params.direction,
    address: params.address,
    subject: params.subject ?? null,
    // Capped: a complaint letter's plain-text part is a few hundred
    // characters, but a forwarded reply can drag a whole thread with it.
    body: params.body?.slice(0, 8000) ?? null,
    body_html: params.bodyHtml?.slice(0, 200_000) ?? null,
    office_name: params.officeName ?? null,
    provider_message_id: params.providerMessageId ?? null,
  });
  if (error) console.error("[municipal-mail] could not record the message", error);
}

/** Everything sent and received for one report, oldest first. */
export async function getMailForIssue(issueId: string): Promise<MunicipalMail[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("municipal_emails")
    .select(
      "id, issue_id, direction, address, subject, body, body_html, office_name, created_at"
    )
    .eq("issue_id", issueId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[municipal-mail] lookup failed", error);
    return [];
  }
  return ((data ?? []) as Row[]).map(toMail);
}

export interface PendingComplaint {
  issueId: string;
  reference: string | null;
  title: string;
  severity: number;
  severityLabel: string;
  category: string;
  address: string | null;
  createdAt: string;
  /** Where it would go, or null when no office covers the location. */
  officeName: string | null;
  officeEmail: string | null;
}

/**
 * Open reports whose complaint has not been sent.
 *
 * This is the queue that exists because filing no longer dispatches anything
 * by itself. Without somewhere to see it, "waiting for approval" and
 * "forgotten" look identical.
 *
 * Offices are matched in memory against the directory rather than one query
 * per report: the directory is a few rows and the queue is short, so a join
 * would cost more than it saves.
 */
export async function getPendingComplaints(): Promise<{
  pending: PendingComplaint[];
  unroutable: number;
}> {
  const supabase = createServiceRoleClient();

  const [issuesRes, sentRes, officesRes] = await Promise.all([
    supabase
      .from("issues")
      .select(
        "id, reference, title, ai_severity, ai_severity_label, ai_category, address, lat, lng, created_at"
      )
      .in("status", ["reported", "acknowledged", "in_progress"])
      .order("ai_severity", { ascending: false }),
    supabase.from("municipal_emails").select("issue_id").eq("direction", "outbound"),
    supabase
      .from("municipal_offices")
      .select("name, contact_email, lat, lng, radius_km")
      .eq("verified", true),
  ]);

  if (issuesRes.error) {
    console.error("[municipal-mail] pending lookup failed", issuesRes.error);
    return { pending: [], unroutable: 0 };
  }

  const alreadySent = new Set(
    ((sentRes.data ?? []) as { issue_id: string }[]).map((r) => r.issue_id)
  );
  const offices = (officesRes.data ?? []) as {
    name: string;
    contact_email: string;
    lat: number;
    lng: number;
    radius_km: number;
  }[];

  const pending: PendingComplaint[] = [];
  let unroutable = 0;

  for (const i of (issuesRes.data ?? []) as {
    id: string;
    reference: string | null;
    title: string;
    ai_severity: number;
    ai_severity_label: string;
    ai_category: string;
    address: string | null;
    lat: number;
    lng: number;
    created_at: string;
  }[]) {
    if (alreadySent.has(i.id)) continue;

    let best: { name: string; email: string; d: number } | null = null;
    for (const o of offices) {
      const d = haversineKm(i.lat, i.lng, o.lat, o.lng);
      if (d > o.radius_km) continue;
      if (!best || d < best.d) best = { name: o.name, email: o.contact_email, d };
    }
    if (!best) unroutable++;

    pending.push({
      issueId: i.id,
      reference: i.reference,
      title: i.title,
      severity: i.ai_severity,
      severityLabel: i.ai_severity_label,
      category: i.ai_category,
      address: i.address,
      createdAt: i.created_at,
      officeName: best?.name ?? null,
      officeEmail: best?.email ?? null,
    });
  }

  return { pending, unroutable };
}

/** One message, with the report it belongs to. Null when it does not exist. */
export async function getMailById(id: number): Promise<MailWithIssue | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("municipal_emails")
    .select(
      "id, issue_id, direction, address, subject, body, body_html, office_name, created_at, issues(title, reference, status)"
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[municipal-mail] single lookup failed", error);
    return null;
  }
  if (!data) return null;

  const row = data as Row & {
    issues?: { title: string; reference: string | null; status: string } | null;
  };
  return {
    ...toMail(row),
    issueTitle: row.issues?.title ?? "(report deleted)",
    issueReference: row.issues?.reference ?? null,
    issueStatus: row.issues?.status ?? "unknown",
  };
}

export interface MailWithIssue extends MunicipalMail {
  issueTitle: string;
  issueReference: string | null;
  issueStatus: string;
}

/** Recent correspondence across every report, newest first. */
export async function getRecentMail(limit = 100): Promise<{
  mail: MailWithIssue[];
  sent: number;
  received: number;
  repliedIssues: number;
}> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("municipal_emails")
    .select(
      "id, issue_id, direction, address, subject, body, body_html, office_name, created_at, issues(title, reference, status)"
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[municipal-mail] recent lookup failed", error);
    return { mail: [], sent: 0, received: 0, repliedIssues: 0 };
  }

  const rows = (data ?? []) as (Row & {
    issues?: { title: string; reference: string | null; status: string } | null;
  })[];

  const mail = rows.map((r) => ({
    ...toMail(r),
    issueTitle: r.issues?.title ?? "(report deleted)",
    issueReference: r.issues?.reference ?? null,
    issueStatus: r.issues?.status ?? "unknown",
  }));

  return {
    mail,
    sent: mail.filter((m) => m.direction === "outbound").length,
    received: mail.filter((m) => m.direction === "inbound").length,
    // How many complaints actually got an answer — the number that says
    // whether the middleman model is working at all.
    repliedIssues: new Set(
      mail.filter((m) => m.direction === "inbound").map((m) => m.issueId)
    ).size,
  };
}
