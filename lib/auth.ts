import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/types";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];

// Server-only helper: resolves the signed-in user's profile row, or null
// if not authenticated. Used by layouts/pages to gate access by role.
export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Goes through the RPC rather than selecting the table directly:
  // `authenticated` is only granted the non-sensitive profile columns (so
  // one citizen can't read another's phone/home location), and this
  // SECURITY DEFINER function returns the caller's own full row.
  const { data: profile } = await supabase
    .rpc("get_my_profile")
    .maybeSingle();

  return profile;
}
