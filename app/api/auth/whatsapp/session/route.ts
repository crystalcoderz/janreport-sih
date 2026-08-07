import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Restrict where a redeemed link can send the browser — the token_hash is
// the actual auth-critical secret (single-use, consumed on verify), but an
// unconstrained redirect target is still an open-redirect footgun worth
// closing off.
const MY_REPORTS = "/my-reports";
const ISSUE_PATH_RE = /^\/issues\/[0-9a-fA-F-]{36}$/;

function safeRedirectPath(raw: string | null): string {
  if (raw && ISSUE_PATH_RE.test(raw)) return raw;
  return MY_REPORTS;
}

// Tapped from a WhatsApp message — completes the magic-link sign-in
// lib/whatsapp/session-link.ts generated, then sends the citizen straight
// to their report.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const redirectPath = safeRedirectPath(searchParams.get("redirect"));

  if (!tokenHash) {
    return NextResponse.redirect(new URL("/login", origin));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: tokenHash,
  });

  if (error) {
    console.error("Failed to redeem WhatsApp session link", error);
    return NextResponse.redirect(new URL("/login?error=link_expired", origin));
  }

  return NextResponse.redirect(new URL(redirectPath, origin));
}
