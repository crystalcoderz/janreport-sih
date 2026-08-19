import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Where a citizen/officer lands after clicking their emailed magic link —
// exchanges the PKCE code Supabase appended to the redirect for a real
// session (sets cookies on this response), then sends them to the right
// home screen for their role.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(new URL("/login?error=link_expired", origin));
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    return NextResponse.redirect(new URL("/login?error=link_expired", origin));
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", data.user.id)
    .single();

  const destination =
    profile?.role === "officer" || profile?.role === "admin" ? "/dashboard" : "/report";
  return NextResponse.redirect(new URL(destination, origin));
}
