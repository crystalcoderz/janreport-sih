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

  // Dev/demo mode: no WHATSAPP_* credentials configured, so nothing was
  // actually delivered — surface the code directly instead of failing
  // closed, so the flow stays testable without a live Meta app.
  console.warn(`[whatsapp otp] not configured — code for ${phone}: ${result.code}`);
  return NextResponse.json({ ok: true, devCode: result.code });
}
