import type { createServiceRoleClient } from "@/lib/supabase/server";

// The citizen's email address, kept off the `issues` table on purpose.
//
// RLS on issues is row-level and permissive — every signed-in user may select
// every row — so any column on that table is readable by anyone who can sign
// up, and signing up is self-service. While the address lived there, a single
// PostgREST call returned every reporter's name, email and the coordinates
// they reported from. The same rows also crossed into client components
// (`select("*")` feeding the map), so Next.js serialised the whole lot into
// the page payload.
//
// Holding it in its own table with no grants to `anon` or `authenticated`
// makes the exposure structurally impossible rather than a column list nobody
// remembers to maintain. Only the service role can read or write it, and only
// to send that citizen their own mail.

type Admin = ReturnType<typeof createServiceRoleClient>;

/** Record the address a citizen gave, if they gave one. Best-effort. */
export async function saveIssueContact(
  admin: Admin,
  issueId: string,
  email: string | null | undefined
): Promise<void> {
  if (!email) return;
  const { error } = await admin
    .from("issue_contacts")
    .upsert({ issue_id: issueId, email }, { onConflict: "issue_id" });
  if (error) {
    // The report itself is already saved; losing the address costs the citizen
    // their email notifications, not their report.
    console.error("[issue-contact] could not store the reporter's email", error);
  }
}

/** The address for one issue, or null if the citizen never gave one. */
export async function getIssueContact(admin: Admin, issueId: string): Promise<string | null> {
  const { data, error } = await admin
    .from("issue_contacts")
    .select("email")
    .eq("issue_id", issueId)
    .maybeSingle();
  if (error) {
    console.error("[issue-contact] lookup failed", error);
    return null;
  }
  return data?.email ?? null;
}
