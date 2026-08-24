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

// Looks up an auth user by email address.
//
// The admin API has no get-by-email, so this pages through the user list. The
// deployment is a few dozen accounts and this only runs on the recovery path
// after a failed create, so the cost is irrelevant; the page cap stops it
// running away if the user base ever grows.
async function findUserByEmail(
  admin: ReturnType<typeof createServiceRoleClient>,
  email: string
): Promise<{ id: string } | null> {
  const target = email.toLowerCase();
  const PER_PAGE = 200;
  const MAX_PAGES = 25;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error) {
      console.error("Failed to list users while recovering an account", error);
      return null;
    }
    const users = data?.users ?? [];
    const hit = users.find((u) => u.email?.toLowerCase() === target);
    if (hit) return { id: hit.id };
    if (users.length < PER_PAGE) return null;
  }
  return null;
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
    // The shadow email or the phone is already on auth.users -- most often
    // because a previous run created the user but failed to write phone back
    // onto the profile, so the lookup above misses every time. Returning null
    // here locked that citizen out of their own account permanently, with no
    // way for them to recover it. Find the existing user instead.
    const recovered = await findUserByEmail(admin, email);
    if (!recovered) {
      console.error("Failed to create WhatsApp-linked user", createError);
      return null;
    }
    console.warn(`[whatsapp profile] recovered an existing account for ${phone}`);
    // Repair the missing link so the fast path works next time.
    const { error: repairError } = await admin
      .from("profiles")
      .update({ phone })
      .eq("id", recovered.id);
    if (repairError) console.error("Failed to relink phone on profile", repairError);
    return { id: recovered.id, email };
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
