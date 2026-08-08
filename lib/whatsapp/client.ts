// Thin wrapper around the Meta WhatsApp Cloud API (Graph API). Server-only —
// never import from client components. Requires WHATSAPP_PHONE_NUMBER_ID and
// WHATSAPP_ACCESS_TOKEN; see README for the Meta Business/WABA setup steps.
const GRAPH_VERSION = "v21.0";

export function isWhatsAppConfigured(): boolean {
  return Boolean(
    process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN
  );
}

async function callGraphApi(path: string, init: RequestInit = {}) {
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      ...init.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WhatsApp Graph API error (${res.status}): ${body}`);
  }
  return res.json();
}

export async function sendWhatsAppText(to: string, body: string) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  return callGraphApi(`${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    }),
  });
}

// Interactive "reply buttons" — WhatsApp allows at most 3, with titles up
// to 20 characters. Tapping one comes back as an inbound message of type
// "interactive" carrying the button's id, which the webhook maps back to a
// category (see QUICK_REPORT_BUTTONS).
export async function sendWhatsAppButtons(
  to: string,
  body: string,
  buttons: { id: string; title: string }[]
) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  return callGraphApi(`${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: body.slice(0, 1024) },
        action: {
          buttons: buttons.slice(0, 3).map((b) => ({
            type: "reply",
            reply: { id: b.id, title: b.title.slice(0, 20) },
          })),
        },
      },
    }),
  });
}

// Marks the citizen's message read and shows the "typing…" bubble. Costs
// one cheap call but changes the whole feel of a turn that needs an LLM
// round-trip: they see the bot working instead of dead air. WhatsApp keeps
// the indicator up for ~25s or until the next message, so there's nothing
// to clear afterwards. Best-effort — never let this block a real reply.
export async function markWhatsAppTyping(messageId: string) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  return callGraphApi(`${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
      typing_indicator: { type: "text" },
    }),
  });
}

export async function sendWhatsAppImage(to: string, imageUrl: string, caption?: string) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  return callGraphApi(`${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "image",
      image: { link: imageUrl, ...(caption ? { caption } : {}) },
    }),
  });
}

export async function sendWhatsAppDocument(
  to: string,
  documentUrl: string,
  filename: string,
  caption?: string
) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  return callGraphApi(`${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "document",
      document: { link: documentUrl, filename, ...(caption ? { caption } : {}) },
    }),
  });
}

// Sends the OTP via an approved "authentication" template if
// WHATSAPP_OTP_TEMPLATE_NAME is set (required for business-initiated
// messages outside a 24h user-reply window — see README). Falls back to a
// free-form text message, which only works within that window (e.g. the
// user just messaged the bot, or you're on Meta's test number).
export async function sendWhatsAppOtpTemplate(to: string, code: string) {
  const templateName = process.env.WHATSAPP_OTP_TEMPLATE_NAME;
  if (!templateName) {
    return sendWhatsAppText(
      to,
      `Your JanReport verification code is ${code}. It expires in 10 minutes.`
    );
  }

  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  return callGraphApi(`${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: "en_US" },
        components: [
          { type: "body", parameters: [{ type: "text", text: code }] },
        ],
      },
    }),
  });
}

export async function sendWhatsAppAudio(to: string, audioUrl: string) {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  return callGraphApi(`${phoneNumberId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "audio",
      audio: { link: audioUrl },
    }),
  });
}

export async function getWhatsAppMediaUrl(mediaId: string): Promise<string> {
  const data = await callGraphApi(mediaId);
  return data.url as string;
}

export async function downloadWhatsAppMedia(
  url: string
): Promise<{ buffer: Buffer; mimeType: string }> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to download WhatsApp media (${res.status})`);
  }
  const mimeType = res.headers.get("content-type") ?? "application/octet-stream";
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, mimeType };
}
