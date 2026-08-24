import { NextResponse, after, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { sendWhatsAppText, isWhatsAppConfigured } from "@/lib/whatsapp/client";
import { sendEmail } from "@/lib/email/client";
import { verifiedOfficeEmails } from "@/lib/municipal-directory";
import { getIssueContact } from "@/lib/issue-contact";
import {
  esc,
  extractNewText,
  findReference,
  htmlToText,
  isValidSignature,
  matchesAllowlist,
} from "@/lib/email/inbound";

export const runtime = "nodejs";

// Receives replies from municipal offices and relays them to the citizen who
// filed the report.
//
// This closes the loop the service exists for: a citizen reports, the office
// is emailed, the office replies here, and the citizen hears back — without
// anyone forwarding mail by hand.
//
// Two independent checks gate every relay, and they guard different things:
//
//   1. The Svix signature proves the request came from Resend. It says nothing
//      about who sent the underlying email.
//   2. The sender allowlist proves the email came from an office we actually
//      wrote to. This is the one that matters: the receiving MX is on the root
//      domain, so anyone on the internet can email reports@janreport.xyz and
//      Resend will faithfully sign and forward it. References are sequential
//      and therefore guessable, so without this check a stranger could have an
//      invented "the municipal office has responded" pushed to a citizen.
//
// Matching is by the reference (JR-YYMM-NNNN), looked for in three places in
// descending order of reliability:
//   1. the plus-address the complaint set as Reply-To — survives any subject
//      rewrite, which clerks do routinely
//   2. the subject line
//   3. the body, since some mail clients drop the plus-address on reply
//
// Unmatched mail is acknowledged with a 200 and logged rather than rejected:
// a 4xx makes the sender retry a message that will never match, and this
// address will also receive ordinary spam.

// The webhook carries metadata only — no body, headers or attachments — so the
// message itself has to be fetched back by id before anything can be matched.
async function fetchReceivedEmail(emailId: string): Promise<{
  text?: string;
  html?: string;
  subject?: string;
  from?: string;
} | null> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("[inbound] RESEND_API_KEY is not set; cannot fetch the message body");
    return null;
  }
  try {
    const res = await fetch(`https://api.resend.com/emails/${emailId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      console.error("[inbound] could not fetch the received email", res.status);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error("[inbound] fetch threw", err);
    return null;
  }
}

// The allowlist entries: every address a complaint can actually be sent to, so
// the set of senders we trust stays in step with who we write to. Same three
// sources as resolveMunicipalRecipient(), in the same order.
async function allowlistEntries(
  supabase: ReturnType<typeof createServiceRoleClient>
): Promise<(string | null)[]> {
  const [departments, offices] = await Promise.all([
    supabase.from("departments").select("contact_email").not("contact_email", "is", null),
    verifiedOfficeEmails(supabase),
  ]);

  return [
    process.env.MUNICIPAL_EMAIL ?? null,
    // Extra addresses or bare domains an operator wants to trust, e.g.
    // "ranchimunicipal.gov.in,pwd.jharkhand.gov.in"
    ...(process.env.INBOUND_ALLOWED_SENDERS ?? "").split(","),
    ...((departments.data ?? []) as { contact_email: string | null }[]).map(
      (d) => d.contact_email
    ),
    ...offices,
  ];
}

export async function POST(request: NextRequest) {
  const raw = await request.text();

  if (!isValidSignature(raw, request.headers)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    console.warn("[inbound] unparseable body");
    return NextResponse.json({ ok: true });
  }

  // Resend nests the message under `data` for webhook events and sends it
  // flat for direct posts; accept both rather than depending on one shape.
  const p = payload as Record<string, unknown>;
  const msg = (p.data ?? p) as Record<string, unknown>;

  const to = Array.isArray(msg.to) ? msg.to.join(" ") : String(msg.to ?? "");
  let from = Array.isArray(msg.from) ? String(msg.from[0]) : String(msg.from ?? "");
  let subject = String(msg.subject ?? "");
  let bodyText = String(msg.text ?? "");
  let bodyHtml = String(msg.html ?? "");
  const emailId = String(msg.email_id ?? msg.id ?? "");

  // Fetch the body when the webhook did not carry one, which is the normal
  // case for email.received.
  if (!bodyText && !bodyHtml) {
    if (!emailId) {
      console.warn("[inbound] no body and no email id; nothing to fetch");
      return NextResponse.json({ ok: true, matched: false });
    }
    const full = await fetchReceivedEmail(emailId);
    // A 502 rather than a 200: Resend stores the message and retries, so a
    // transient API failure delays the relay instead of destroying it.
    // Answering 200 here would mark the delivery successful and the office's
    // actual words would be lost for good.
    if (!full) {
      return NextResponse.json({ error: "Could not retrieve the message" }, { status: 502 });
    }
    bodyText = full.text ?? "";
    bodyHtml = full.html ?? "";
    // Prefer the signed webhook metadata; the fetched copy only fills gaps.
    subject = subject || (full.subject ?? "");
    from = from || (full.from ?? "");
  }

  const plain = bodyText || htmlToText(bodyHtml);
  const reference = findReference(to, subject, plain);
  if (!reference) {
    console.warn(`[inbound] no reference found; from=${from} subject=${subject.slice(0, 80)}`);
    return NextResponse.json({ ok: true, matched: false });
  }

  // Answer Resend immediately; relaying involves WhatsApp and email calls that
  // comfortably exceed a webhook timeout.
  after(async () => {
    const supabase = createServiceRoleClient();

    if (!matchesAllowlist(from, await allowlistEntries(supabase))) {
      console.warn(
        `[inbound] ${reference}: refused a reply from ${from} — not a configured municipal sender`
      );
      return;
    }

    // Idempotency. Svix retries on any non-2xx, and the 502 above makes that a
    // routine path rather than a rare one, so the same message can arrive more
    // than once. Claim it first; a duplicate key means another delivery of the
    // same email already did this work.
    if (emailId) {
      const { error: claimError } = await supabase
        .from("inbound_emails")
        .insert({ email_id: emailId, reference });
      if (claimError) {
        if (claimError.code === "23505") {
          console.log(`[inbound] ${reference}: ${emailId} already processed, skipping`);
          return;
        }
        console.error("[inbound] could not claim the message", claimError);
      }
    }

    const { data: issue, error: issueError } = await supabase
      .from("issues")
      .select("id, reference, title, status, reporter_id, reporter_name")
      .eq("reference", reference)
      .maybeSingle();

    if (issueError) {
      console.error("[inbound] issue lookup failed", issueError);
      return;
    }
    if (!issue) {
      console.warn(`[inbound] reference ${reference} matches no report`);
      return;
    }

    const reply = extractNewText(plain);
    if (!reply) {
      // Nothing but quoted history. Worth recording that the office wrote
      // back, but not worth pushing an empty message to the citizen.
      await supabase.from("issue_status_history").insert({
        issue_id: issue.id,
        status: issue.status,
        note: `Reply from ${from} contained no new text.`,
        changed_by: null,
      });
      console.log(`[inbound] ${reference}: reply had no new text; not relayed`);
      return;
    }

    // Recorded on the timeline first, so the update survives even if both
    // notifications fail. status is unchanged — an officer decides that; this
    // is correspondence, not a state transition.
    const { error: historyError } = await supabase.from("issue_status_history").insert({
      issue_id: issue.id,
      status: issue.status,
      note: `Reply from ${from}:\n${reply}`,
      changed_by: null,
    });
    if (historyError) {
      console.error("[inbound] could not record the reply", historyError);
    }

    // Tell the citizen, on whichever channels they left us. `reference` is the
    // value we matched on, so it stands in if the column is somehow null.
    const ref = issue.reference ?? reference;
    const summary =
      `📬 *Update on your report*\n` +
      `*Ref:* ${ref}\n` +
      `*Issue:* ${issue.title}\n\n` +
      `The municipal office has responded:\n"${reply.slice(0, 700)}"`;

    const { data: profile } = issue.reporter_id
      ? await supabase.from("profiles").select("phone").eq("id", issue.reporter_id).maybeSingle()
      : { data: null };

    if (profile?.phone && isWhatsAppConfigured()) {
      await sendWhatsAppText(profile.phone, summary).catch((err) =>
        console.error("[inbound] WhatsApp relay failed", err)
      );
    }

    const reporterEmail = await getIssueContact(supabase, issue.id);
    if (reporterEmail) {
      await sendEmail({
        to: reporterEmail,
        subject: `Update on ${ref} — ${issue.title}`,
        text: `The municipal office has responded to your report.\n\nRef: ${ref}\n\n${reply}`,
        html:
          `<div style="font:400 15px/23px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#3f3f46;max-width:520px;">` +
          `<div style="font:600 11px;letter-spacing:0.09em;text-transform:uppercase;color:#71717a;padding-bottom:8px;">Reply from the municipal office</div>` +
          `<h1 style="margin:0 0 6px;font-size:20px;color:#18181b;">${esc(issue.title)}</h1>` +
          `<p style="margin:0 0 18px;color:#71717a;font-size:13px;">Ref ${esc(ref)}</p>` +
          `<div style="border-left:2px solid #18181b;padding:2px 0 2px 16px;white-space:pre-wrap;">${esc(
            reply
          )}</div></div>`,
      }).catch((err) => console.error("[inbound] email relay failed", err));
    }

    console.log(`[inbound] ${reference}: relayed a reply from ${from}`);
  });

  return NextResponse.json({ ok: true, matched: true, reference });
}
