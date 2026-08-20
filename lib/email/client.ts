// Thin wrapper around Resend's REST API. Deliberately not the `resend` npm
// package: one fetch call is the whole surface we need, and this keeps the
// dependency list (and the cold start) smaller.
//
// Server-only. RESEND_API_KEY must never reach the client.

const RESEND_ENDPOINT = "https://api.resend.com/emails";

// Sent from the verified domain rather than Resend's shared onboarding
// sender, so citizens see the service's own address and deliverability is
// not shared with every other Resend trial account.
const DEFAULT_FROM = process.env.EMAIL_FROM || "JanReport <noreply@janreport.xyz>";

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

export interface SendEmailResult {
  ok: boolean;
  id?: string;
  error?: string;
}

export async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
  /** Plain-text fallback. Worth setting — some clients and most spam filters read it. */
  text?: string;
  replyTo?: string;
}): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // Not an error worth throwing: email is an enhancement, and a report
    // must still file if it is unconfigured.
    console.warn("[email] RESEND_API_KEY not set — skipping send");
    return { ok: false, error: "not_configured" };
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: DEFAULT_FROM,
        to: [params.to],
        subject: params.subject,
        html: params.html,
        ...(params.text ? { text: params.text } : {}),
        ...(params.replyTo ? { reply_to: params.replyTo } : {}),
      }),
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("[email] send failed", res.status, body);
      return { ok: false, error: body?.message ?? `HTTP ${res.status}` };
    }
    return { ok: true, id: body?.id };
  } catch (err) {
    console.error("[email] send threw", err);
    return { ok: false, error: String(err) };
  }
}
