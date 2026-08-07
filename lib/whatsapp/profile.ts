import { createServiceRoleClient } from "@/lib/supabase/server";

// A citizen's WhatsApp number never has a "password" login — Supabase Auth
// still requires an email on the underlying user, so we mint a
// deterministic, never-shown shadow address and drive everything else
// (OTP login, the reporting bot) off the phone number instead.
export function shadowEmailFor(phone: string): string {
  return `wa-${phone.replace(/\D/g, "")}@whatsapp.janreport.internal`;
}

// Same as getOrCreateProfileByPhone but skips resolving the account's
// email. The webhook runs this on every inbound message and only ever
// needs `id`, so the extra Auth admin round-trip that getUserById costs
// was pure latency on the hot path.
export async function getOrCreateProfileIdByPhone(
  phone: string
): Promise<string | null> {
  const admin = createServiceRoleClient();

  const { data: existing } = await admin
    .from("profiles")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();

  if (existing) return existing.id;

  const profile = await getOrCreateProfileByPhone(phone);
  return profile?.id ?? null;
}

// Finds the profile already linked to this WhatsApp number, or provisions
// a brand-new citizen account for it. Used by the OTP login route and the
// session-link helper, which both need `email` to bootstrap a session.
export async function getOrCreateProfileByPhone(
  phone: string,
  fullName?: string | null
): Promise<{ id: string; email: string } | null> {
  const admin = createServiceRoleClient();

  const { data: existing } = await admin
    .from("profiles")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();

  if (existing) {
    const { data: userData, error } = await admin.auth.admin.getUserById(existing.id);
    if (error || !userData.user?.email) return null;
    return { id: existing.id, email: userData.user.email };
  }

  const email = shadowEmailFor(phone);
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    phone,
    email_confirm: true,
    phone_confirm: true,
    password: crypto.randomUUID(),
    user_metadata: fullName ? { full_name: fullName } : {},
  });
  if (createError || !created.user) {
    console.error("Failed to create WhatsApp-linked user", createError);
    return null;
  }

  // handle_new_user() (schema.sql) already created the profiles row — it
  // just doesn't know the phone number yet.
  const { error: phoneUpdateError } = await admin
    .from("profiles")
    .update({ phone })
    .eq("id", created.user.id);
  if (phoneUpdateError) {
    console.error("Failed to persist phone on profile", phoneUpdateError);
  }

  return { id: created.user.id, email };
}
