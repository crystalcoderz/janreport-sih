import { createServiceRoleClient } from "@/lib/supabase/server";
import { getOrCreateProfileByPhone } from "@/lib/whatsapp/profile";

// Mints a one-time, single-use link that signs a WhatsApp citizen straight
// into their own account on the web app — no password, no separate OTP
// step. Redeeming it (app/api/auth/whatsapp/session/route.ts) consumes the
// underlying Supabase magic-link token, same mechanism the WhatsApp OTP
// login flow already uses, just redeemed by whichever browser taps the
// link instead of the one that requested it.
export async function createWhatsAppSessionLink(
  phone: string,
  redirectPath: string
): Promise<string | null> {
  const profile = await getOrCreateProfileByPhone(phone);
  if (!profile) return null;

  const admin = createServiceRoleClient();
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: profile.email,
  });
  if (error || !data.properties) {
    console.error("Failed to generate WhatsApp session link", error);
    return null;
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!baseUrl) {
    // Fail loudly rather than silently pointing the citizen at a wrong or
    // stale domain — a hardcoded fallback here has already caused a real
    // bug once (an old deployment's build-time value outliving an env var
    // change), so this must never guess.
    console.error("NEXT_PUBLIC_APP_URL is not set — cannot build a session link");
    return null;
  }
  const url = new URL("/api/auth/whatsapp/session", baseUrl);
  url.searchParams.set("token_hash", data.properties.hashed_token);
  url.searchParams.set("redirect", redirectPath);
  return url.toString();
}
