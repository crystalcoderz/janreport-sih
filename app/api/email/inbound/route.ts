import { NextResponse, after, type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { sendWhatsAppText, isWhatsAppConfigured } from "@/lib/whatsapp/client";
import { sendEmail } from "@/lib/email/client";

export const runtime = "nodejs";

// Receives replies from municipal offices and relays them to the citizen who
// filed the report.
//
// This closes the loop the service exists for: a citizen reports, the office
// is emailed, the office replies here, and the citizen hears back — without
// anyone forwarding mail by hand.
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

const REFERENCE_RE = /\bJR-\d{4}-\d{4}\b/i;

function findReference(...haystacks: (string | null | undefined)[]): string | null {
  for (const h of haystacks) {
    const m = h?.match(REFERENCE_RE);
    if (m) return m[0].toUpperCase();
  }
  return null;
}

// Quoted history makes relayed replies unreadable on a phone, so keep only
// what the sender actually typed: everything above the first quote marker.
function extractNewText(body: string): string {
  const cut = body.search(
    /(^>)|(^On .+ wrote:)|(-----Original Message-----)|(^From: )|(_{10,})/m
  );
  const head = cut > 0 ? body.slice(0, cut) : body;
  return head.replace(/\s+\n/g, "\n").trim().slice(0, 1500);
}

// Resend signs webhooks the Svix way: HMAC-SHA256 over "<id>.<timestamp>.<body>"
// with the secret after its `whsec_` prefix, base64-encoded, and the header may
// carry several space-separated candidate signatures during a secret rotation.
// Implemented here rather than pulling in the svix package for one function.
function isValidSignature(raw: string, headers: Headers): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  // Unset means the endpoint is not yet wired to Resend; accept and warn
  // rather than silently discarding real mail during setup.
  if (!secret) return true;

  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signature = headers.get("svix-signature");
  if (!id || !timestamp || !signature) return false;

  // Reject anything older than five minutes so a captured request cannot be
  // replayed indefinitely.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${raw}`)
    .digest("base64");

  return signature.split(" ").some((part) => {
    const candidate = part.split(",")[1];
    if (!candidate) return false;
    const a = Buffer.from(candidate);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

// The webhook carries metadata only — no body, headers or attachments — so the
// message itself has to be fetched back by id before anything can be matched.
async function fetchReceivedEmail(
  emailId: string
): Promise<{ text?: string; html?: string; subject?: string; from?: string; to?: string[] } | null> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
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

export async function POST(request: NextRequest) {
  const raw = await request.text();

  if (!isValidSignature(raw, request.headers)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }
  if (!process.env.RESEND_WEBHOOK_SECRET) {
    console.warn("[inbound] RESEND_WEBHOOK_SECRET not set — signature not verified");
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
  const from = Array.isArray(msg.from) ? msg.from[0] : String(msg.from ?? "");
  const subject = String(msg.subject ?? "");
  const text = String(msg.text ?? "");
  const html = String(msg.html ?? "");

  // Fetch the body when the webhook did not carry one, which is the normal
  // case for email.received.
  let bodyText = text;
  let bodyHtml = html;
  let realSubject = subject;
  let realFrom = from;
  const emailId = String(msg.email_id ?? msg.id ?? "");
  if (!bodyText && !bodyHtml && emailId) {
    const full = await fetchReceivedEmail(emailId);
    if (full) {
      bodyText = full.text ?? "";
      bodyHtml = full.html ?? "";
      realSubject = full.subject ?? realSubject;
      realFrom = Array.isArray(full.to) ? realFrom : (full.from ?? realFrom);
    }
  }

  const reference = findReference(to, realSubject, bodyText, bodyHtml);
  if (!reference) {
    console.warn(`[inbound] no reference found; from=${realFrom} subject=${realSubject.slice(0, 80)}`);
    return NextResponse.json({ ok: true, matched: false });
  }

  // Answer Resend immediately; relaying involves WhatsApp and email calls that
  // comfortably exceed a webhook timeout.
  after(async () => {
    const supabase = createServiceRoleClient();
    const { data: issue } = await supabase
      .from("issues")
      .select("id, reference, title, status, reporter_id, reporter_email, reporter_name")
      .eq("reference", reference)
      .maybeSingle();

    if (!issue) {
      console.warn(`[inbound] reference ${reference} matches no report`);
      return;
    }

    const reply =
      extractNewText(bodyText || bodyHtml.replace(/<[^>]+>/g, " ")) || "(no message body)";

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

    // Tell the citizen, on whichever channels they left us.
    const summary =
      `📬 *Update on your report*\n` +
      `*Ref:* ${issue.reference}\n` +
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

    if (issue.reporter_email) {
      await sendEmail({
        to: issue.reporter_email,
        subject: `Update on ${issue.reference} — ${issue.title}`,
        text: `The municipal office has responded to your report.\n\nRef: ${issue.reference}\n\n${reply}`,
        html:
          `<div style="font:400 15px/23px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#3f3f46;max-width:520px;">` +
          `<div style="font:600 11px;letter-spacing:0.09em;text-transform:uppercase;color:#71717a;padding-bottom:8px;">Reply from the municipal office</div>` +
          `<h1 style="margin:0 0 6px;font-size:20px;color:#18181b;">${issue.title.replace(/</g, "&lt;")}</h1>` +
          `<p style="margin:0 0 18px;color:#71717a;font-size:13px;">Ref ${issue.reference}</p>` +
          `<div style="border-left:2px solid #18181b;padding:2px 0 2px 16px;white-space:pre-wrap;">${reply
            .replace(/</g, "&lt;")
            .slice(0, 1500)}</div></div>`,
      }).catch((err) => console.error("[inbound] email relay failed", err));
    }

    console.log(`[inbound] ${reference}: relayed a reply from ${realFrom}`);
  });

  return NextResponse.json({ ok: true, matched: true, reference });
}
