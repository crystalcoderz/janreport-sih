import { NextResponse, type NextRequest } from "next/server";
import { normalizePhone, issueOtp } from "@/lib/whatsapp/otp";
import { isWhatsAppConfigured, sendWhatsAppOtpTemplate } from "@/lib/whatsapp/client";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const phone =
    typeof body?.phone === "string" ? normalizePhone(body.phone) : null;

  if (!phone) {
    return NextResponse.json(
      { error: "Enter a valid phone number, with country code." },
      { status: 400 }
    );
  }

  const result = await issueOtp(phone);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 429 });
  }

  if (isWhatsAppConfigured()) {
    try {
      await sendWhatsAppOtpTemplate(phone, result.code);
    } catch (err) {
      console.error("Failed to send WhatsApp OTP", err);
      return NextResponse.json(
        { error: "Could not send the WhatsApp message. Please try again." },
        { status: 502 }
      );
    }
    return NextResponse.json({ ok: true });
  }

  // No WHATSAPP_* credentials, so nothing was delivered. Returning the code
  // to the caller makes this an account-takeover endpoint — anyone could
  // request and redeem a code for someone else's linked number — so it is
  // only ever allowed when explicitly opted into for local development.
  // Everything else fails closed, including a deployment that merely lost
  // its credentials (an expired token must not silently unlock accounts).
  if (process.env.WHATSAPP_ALLOW_DEV_OTP === "true" && process.env.NODE_ENV !== "production") {
    console.warn(`[whatsapp otp] dev mode — code for ${phone}: ${result.code}`);
    return NextResponse.json({ ok: true, devCode: result.code });
  }

  console.error("[whatsapp otp] WhatsApp is not configured — refusing to issue a code");
  return NextResponse.json(
    { error: "WhatsApp sign-in is unavailable right now. Please use email instead." },
    { status: 503 }
  );
}
