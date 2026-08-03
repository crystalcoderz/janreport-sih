import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { normalizePhone, verifyOtpCode } from "@/lib/whatsapp/otp";
import { getOrCreateProfileByPhone } from "@/lib/whatsapp/profile";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const phone =
    typeof body?.phone === "string" ? normalizePhone(body.phone) : null;
  const code = typeof body?.code === "string" ? body.code.trim() : null;
  const fullName =
    typeof body?.fullName === "string" ? body.fullName.trim().slice(0, 100) : null;

  if (!phone || !code) {
    return NextResponse.json(
      { error: "Phone and code are required." },
      { status: 400 }
    );
  }

  const verification = await verifyOtpCode(phone, code);
  if (!verification.ok) {
    return NextResponse.json({ error: verification.error }, { status: 400 });
  }

  const profile = await getOrCreateProfileByPhone(phone, fullName);
  if (!profile) {
    return NextResponse.json(
      { error: "Could not sign you in. Please try again." },
      { status: 500 }
    );
  }

  // Bootstrap a real session without Supabase's own SMS/phone-OTP system:
  // mint a magic link server-side, then immediately redeem its token hash
  // against the request's cookie-bound client.
  const admin = createServiceRoleClient();
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: profile.email,
  });
  if (linkError || !linkData.properties) {
    console.error("Failed to generate session link", linkError);
    return NextResponse.json(
      { error: "Could not sign you in. Please try again." },
      { status: 500 }
    );
  }

  const supabase = await createClient();
  const { error: sessionError } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: linkData.properties.hashed_token,
  });
  if (sessionError) {
    console.error("Failed to establish session", sessionError);
    return NextResponse.json(
      { error: "Could not sign you in. Please try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
