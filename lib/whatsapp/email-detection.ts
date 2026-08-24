// Pulls an email address out of a citizen's message, and recognises them
// declining to give one.
//
// Deterministic for the same reason name and location detection are: the
// agent reliably replies "Noted!" without calling the tool, and an address it
// claims to have saved but hasn't is worse than not asking at all — the
// citizen believes they will be emailed and never is.

// Deliberately not RFC 5322. That grammar accepts things no citizen types and
// rejects nothing they do; this matches what people actually write, then lets
// the send fail harmlessly if it is wrong.
const EMAIL_RE = /\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/;

// Typed on a phone keyboard, "@gmail.com" often arrives with spaces around
// the @ or a capitalised domain.
const SPACED_EMAIL_RE =
  /\b([a-zA-Z0-9._%+-]+)\s*@\s*([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/;

const DECLINE_RE =
  /^(no|nope|nahi|nahin|skip|later|cancel|na|n|no email|no mail|dont have|don't have|nahi hai|nhi|koi nahi|not now|no thanks|no thank you|leave it|chhodo|chod do)\b/i;

/** The address in this message, normalised, or null. */
export function extractEmail(text: string): string | null {
  const direct = text.match(EMAIL_RE);
  if (direct) return normalize(direct[1]);

  const spaced = text.match(SPACED_EMAIL_RE);
  if (spaced) return normalize(`${spaced[1]}@${spaced[2]}`);

  return null;
}

// Lowercased because addresses are case-insensitive in practice and phone
// keyboards capitalise the first letter of a message; a trailing full stop is
// sentence punctuation, not part of the domain.
function normalize(raw: string): string {
  return raw.trim().toLowerCase().replace(/[.,;:]+$/, "");
}

// Phrases that make an address the citizen's OWN, rather than one they happen
// to mention. Civic reports do quote third-party addresses -- "the contractor
// is at works@example.com", "I already wrote to pwd@example.gov.in" -- and
// storing one of those as the reporter's means their confirmation, and every
// status update after it, is emailed to a stranger along with the report.
const OWN_EMAIL_ANCHOR_RE =
  /\b(?:my|mera|meri)\s+(?:e-?mail|mail|id)\b|\b(?:e-?mail|mail)\s+(?:me|mujhe)\b|\bmail\s+id\b|\bsend\s+(?:it\s+)?to\s+me\b/i;

/**
 * True when the message presents the address as the sender's own.
 *
 * Used to decide whether to capture an address nobody asked for. When the bot
 * has actually asked, the reply is the answer and this check is unnecessary.
 */
export function claimsOwnEmail(text: string): boolean {
  return OWN_EMAIL_ANCHOR_RE.test(text);
}

/** True when the citizen is saying they'd rather not give an address. */
export function isEmailDecline(text: string): boolean {
  return DECLINE_RE.test(text.trim());
}
