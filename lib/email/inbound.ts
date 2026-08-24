import { createHmac, timingSafeEqual } from "crypto";

// Pure helpers for the inbound reply webhook (app/api/email/inbound/route.ts).
//
// They live here rather than in the route because a Next.js route module may
// only export handlers and route config, and because every one of these is
// worth testing directly — see inbound.test.ts.

export const REFERENCE_RE = /\bJR-\d{4}-\d{4}\b/i;

export function findReference(...haystacks: (string | null | undefined)[]): string | null {
  for (const h of haystacks) {
    const m = h?.match(REFERENCE_RE);
    if (m) return m[0].toUpperCase();
  }
  return null;
}

export function esc(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** "Nagar Nigam <clerk@office.gov.in>" -> "clerk@office.gov.in" */
export function bareAddress(v: string): string {
  const angled = v.match(/<([^>]+)>/);
  return (angled ? angled[1] : v).trim().toLowerCase();
}

// HTML-only replies are common, and the quoting conventions extractNewText
// looks for are plain-text ones. Turn the markup that actually carries quoting
// into those markers before flattening, and drop <style>/<script> outright —
// otherwise a stylesheet is relayed to the citizen as the reply body.
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<blockquote\b[^>]*>/gi, "\n> ")
    .replace(/<div\b[^>]*(?:gmail_quote|OutlookMessageHeader|moz-cite-prefix)[^>]*>/gi, "\n> ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/&apos;/gi, "'")
    // last, so an escaped "&amp;lt;" is not decoded twice back into a tag
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n");
}

// Quoted history makes relayed replies unreadable on a phone, so keep only
// what the sender actually typed: everything above the first quote marker.
//
// `cut === 0` means the message opens with quoted history and carries no new
// text at all, so that has to yield an empty string rather than the whole
// thread; only a genuine -1 (no marker anywhere) keeps the body intact.
export function extractNewText(body: string): string {
  const cut = body.search(
    /(^>)|(^On .+ wrote:)|(-----Original Message-----)|(^From: )|(_{10,})/m
  );
  const head = cut >= 0 ? body.slice(0, cut) : body;
  return head.replace(/\s+\n/g, "\n").trim().slice(0, 1500);
}

// Resend signs webhooks the Svix way: HMAC-SHA256 over "<id>.<timestamp>.<body>"
// with the secret after its `whsec_` prefix, base64-decoded to bytes, and the
// header may carry several space-separated candidate signatures during a secret
// rotation. Implemented here rather than pulling in the svix package for one
// function.
export function isValidSignature(
  raw: string,
  headers: Headers,
  env: Record<string, string | undefined> = process.env
): boolean {
  const secret = env.RESEND_WEBHOOK_SECRET;

  // Fail closed. A missing secret is a misconfiguration, not a licence to
  // accept anything: without it this route is an open "send a WhatsApp to a
  // citizen as their municipal office" endpoint. The escape hatch is an
  // explicit opt-in that is additionally refused in production, so it cannot
  // be turned on by accident on the deployed host.
  if (!secret) {
    if (env.INBOUND_ALLOW_UNSIGNED === "1" && env.NODE_ENV !== "production") {
      console.warn("[inbound] unsigned request allowed — development only");
      return true;
    }
    console.error("[inbound] RESEND_WEBHOOK_SECRET is not set; rejecting");
    return false;
  }

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

// Domains where an address says nothing about who the sender is.
//
// This matters more than it looks. Indian municipal bodies genuinely publish
// free webmail addresses as their official contact -- Nagar Nigam Ghaziabad
// lists gzb.nagar.nigam@gmail.com on its own site, and Mathura-Vrindavan does
// the same. Domain-matching those would make every Gmail account on earth a
// trusted municipal sender, so for these domains only an exact address match
// counts.
const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.in",
  "yahoo.in",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "rediffmail.com",
  "rediff.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "protonmail.com",
  "proton.me",
  "zoho.com",
  "zohomail.in",
  "mail.com",
  "gmx.com",
  "yandex.com",
]);

// Who is allowed to speak as a municipal office.
//
// The allowlist is built from the same addresses a complaint is actually sent
// to, so it can never drift from who we wrote to. Entries may be full
// addresses or bare domains.
//
// Domains are matched as well as exact addresses, because a complaint
// addressed to the commissioner is routinely answered by a clerk at the same
// office -- but never for a public webmail domain, where the domain identifies
// nobody. There, the address must match exactly.
//
// An empty allowlist refuses everything, which is the correct posture: if no
// office has been given an address, no office can legitimately be replying.
export function matchesAllowlist(from: string, entries: (string | null | undefined)[]): boolean {
  const addr = bareAddress(from);
  const domain = addr.split("@")[1];
  if (!addr || !domain) return false;

  const allowed = new Set<string>();
  for (const e of entries) {
    const t = e?.trim().toLowerCase();
    if (t) allowed.add(t);
  }
  if (allowed.size === 0) return false;
  if (allowed.has(addr)) return true;

  // Exact match was the only chance for a webmail sender.
  if (PUBLIC_EMAIL_DOMAINS.has(domain)) return false;

  return [...allowed].some((entry) => {
    const entryDomain = entry.includes("@") ? entry.split("@")[1] : entry;
    if (!entryDomain || PUBLIC_EMAIL_DOMAINS.has(entryDomain)) return false;
    return entryDomain === domain;
  });
}
