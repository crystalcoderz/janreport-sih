import { createHash, randomInt } from "crypto";
import { createServiceRoleClient } from "@/lib/supabase/server";

const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_ATTEMPTS = 5;
// request-otp is public and unauthenticated — the per-phone cooldown below
// doesn't stop one caller from fanning out across many different numbers,
// and each successful send is a real billed WhatsApp message to whoever
// that number belongs to. This bounds a single source regardless of how
// many numbers it targets. Deliberately generous: carrier-grade NAT means
// a whole neighborhood can share one public IP in India.
const IP_WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_IP_PER_WINDOW = 10;

export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim().replace(/[\s\-()]/g, "");
  if (!/^\+?[1-9]\d{7,14}$/.test(trimmed)) return null;
  return trimmed.startsWith("+") ? trimmed : `+${trimmed}`;
}

// Hashes are peppered with the service role key (already a server-only
// secret in this codebase) so a DB-only read can't recover valid codes.
function hashCode(phone: string, code: string): string {
  const pepper = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  return createHash("sha256").update(`${phone}:${code}:${pepper}`).digest("hex");
}

export async function issueOtp(
  phone: string,
  ip: string | null
): Promise<{ ok: true; code: string } | { ok: false; error: string }> {
  const supabase = createServiceRoleClient();

  const { data: recent } = await supabase
    .from("whatsapp_otp_codes")
    .select("created_at")
    .eq("phone", phone)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (
    recent &&
    Date.now() - new Date(recent.created_at).getTime() < RESEND_COOLDOWN_MS
  ) {
    return {
      ok: false,
      error: "Please wait a minute before requesting another code.",
    };
  }

  if (ip) {
    const { count } = await supabase
      .from("whatsapp_otp_codes")
      .select("id", { count: "exact", head: true })
      .eq("ip", ip)
      .gte("created_at", new Date(Date.now() - IP_WINDOW_MS).toISOString());

    if ((count ?? 0) >= MAX_PER_IP_PER_WINDOW) {
      return {
        ok: false,
        error: "Too many code requests from this network. Please try again later.",
      };
    }
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const { error } = await supabase.from("whatsapp_otp_codes").insert({
    phone,
    code_hash: hashCode(phone, code),
    expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
    ip,
  });

  if (error) {
    return { ok: false, error: "Could not generate a code. Please try again." };
  }
  return { ok: true, code };
}

export async function verifyOtpCode(
  phone: string,
  code: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createServiceRoleClient();

  const { data: row } = await supabase
    .from("whatsapp_otp_codes")
    .select("*")
    .eq("phone", phone)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!row) {
    return { ok: false, error: "No code found — request a new one." };
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, error: "That code has expired — request a new one." };
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    return { ok: false, error: "Too many attempts — request a new one." };
  }

  if (hashCode(phone, code) !== row.code_hash) {
    await supabase
      .from("whatsapp_otp_codes")
      .update({ attempts: row.attempts + 1 })
      .eq("id", row.id);
    return { ok: false, error: "Incorrect code." };
  }

  await supabase
    .from("whatsapp_otp_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", row.id);
  return { ok: true };
}
