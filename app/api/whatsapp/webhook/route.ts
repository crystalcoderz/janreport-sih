import { NextResponse, type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import {
  getWhatsAppMediaUrl,
  downloadWhatsAppMedia,
  sendWhatsAppText,
} from "@/lib/whatsapp/client";
import { normalizePhone } from "@/lib/whatsapp/otp";
import {
  savePhotoToSession,
  saveLocationToSession,
  saveNoteToSession,
  finalizeReportIfReady,
} from "@/lib/whatsapp/report";

export const runtime = "nodejs";

// Meta calls this once, at webhook setup time, to confirm you control the
// endpoint before it starts forwarding real messages.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const challenge = searchParams.get("hub.challenge");

  if (
    searchParams.get("hub.mode") === "subscribe" &&
    searchParams.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN &&
    challenge
  ) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: "Verification failed" }, { status: 403 });
}

function isValidSignature(rawBody: string, signatureHeader: string | null): boolean {
  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret || !signatureHeader?.startsWith("sha256=")) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const provided = signatureHeader.slice("sha256=".length);
  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(provided, "hex");
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

interface WhatsAppMessage {
  from: string;
  type: string;
  text?: { body: string };
  image?: { id: string; caption?: string };
  location?: { latitude: number; longitude: number };
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  if (!process.env.WHATSAPP_APP_SECRET) {
    console.warn(
      "[whatsapp webhook] WHATSAPP_APP_SECRET not set — skipping signature verification (dev mode only)"
    );
  } else if (!isValidSignature(rawBody, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const payload = JSON.parse(rawBody);
  const messages: WhatsAppMessage[] =
    payload?.entry?.[0]?.changes?.[0]?.value?.messages ?? [];

  for (const message of messages) {
    await handleMessage(message);
  }

  // Always 200 — Meta retries aggressively on non-2xx, and any failure is
  // already surfaced to the sender via a WhatsApp reply below.
  return NextResponse.json({ ok: true });
}

async function handleMessage(message: WhatsAppMessage) {
  const phone = normalizePhone(message.from);
  if (!phone) return;

  try {
    switch (message.type) {
      case "image": {
        if (!message.image) return;
        const mediaUrl = await getWhatsAppMediaUrl(message.image.id);
        const { buffer, mimeType } = await downloadWhatsAppMedia(mediaUrl);
        const saved = await savePhotoToSession(phone, buffer, mimeType);
        if (!saved.ok) {
          await sendWhatsAppText(phone, saved.error);
          return;
        }
        if (message.image.caption) {
          await saveNoteToSession(phone, message.image.caption);
        }
        const finalized = await finalizeReportIfReady(phone);
        if (!finalized) {
          await sendWhatsAppText(
            phone,
            "Got the photo 📸 — now share your location (tap 📎 → Location) so we can pinpoint the issue."
          );
        }
        return;
      }
      case "location": {
        if (!message.location) return;
        const saved = await saveLocationToSession(
          phone,
          message.location.latitude,
          message.location.longitude
        );
        if (!saved.ok) {
          await sendWhatsAppText(phone, saved.error);
          return;
        }
        const finalized = await finalizeReportIfReady(phone);
        if (!finalized) {
          await sendWhatsAppText(
            phone,
            "Got your location 📍 — now send a photo of the issue to file the report."
          );
        }
        return;
      }
      case "text": {
        const body = message.text?.body?.trim();
        if (!body) return;
        if (/^(hi|hello|hey|start|help)$/i.test(body)) {
          await sendWhatsAppText(
            phone,
            "👋 Welcome to JanReport! To report a civic issue, send a photo of it, then share your location. You can add a text note too."
          );
          return;
        }
        await saveNoteToSession(phone, body);
        await sendWhatsAppText(
          phone,
          "Got it, noted. Send a photo and your location to file the report."
        );
        return;
      }
      default:
        return;
    }
  } catch (err) {
    console.error("Failed to handle WhatsApp message", err);
    await sendWhatsAppText(
      phone,
      "Sorry, something went wrong. Please try again in a moment."
    ).catch(() => {});
  }
}
