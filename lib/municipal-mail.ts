import { createServiceRoleClient } from "@/lib/supabase/server";

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
