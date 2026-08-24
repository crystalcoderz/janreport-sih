import { NextResponse, after, type NextRequest } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import {
  getWhatsAppMediaUrl,
  downloadWhatsAppMedia,
  sendWhatsAppText,
  sendWhatsAppImage,
  sendWhatsAppAudio,
  sendWhatsAppButtons,
  markWhatsAppTyping,
} from "@/lib/whatsapp/client";
import { normalizePhone } from "@/lib/whatsapp/otp";
import { getOrCreateProfileIdByPhone } from "@/lib/whatsapp/profile";
import {
  savePhotoToSession,
  saveLocationToSession,
  saveNoteToSession,
  saveReporterNameToSession,
  saveReporterEmailToSession,
  EMAIL_ASKED,
  getReportSessionState,
  clearReportSessionIfStale,
  finalizeReportIfReady,
  clearReportSession,
} from "@/lib/whatsapp/report";
import { extractStatedName } from "@/lib/whatsapp/name-detection";
import { extractEmail, isEmailDecline } from "@/lib/whatsapp/email-detection";
import { sendEmail } from "@/lib/email/client";
import { reportFiledEmail } from "@/lib/email/templates";
import { sendMunicipalComplaint } from "@/lib/email/municipal";
import { isLinkRequest } from "@/lib/whatsapp/link-request";
import { isCancelRequest } from "@/lib/whatsapp/cancel-request";
import { resolvePendingReportInput } from "@/lib/whatsapp/pending-input";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createWhatsAppSessionLink } from "@/lib/whatsapp/session-link";
import { transcribeAudio } from "@/lib/ai/transcribe";
import { runKimiAgent } from "@/lib/kimi/agent";
import { WHATSAPP_TOOL_DEFINITIONS } from "@/lib/kimi/tools";
import { isKimiConfigured } from "@/lib/kimi/client";

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
  id?: string;
  type: string;
  text?: { body: string };
  image?: { id: string; caption?: string };
  audio?: { id: string; mime_type?: string };
  location?: { latitude: number; longitude: number };
  interactive?: {
    type: string;
    button_reply?: { id: string; title: string };
  };
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Meta's webhook shape, narrowed immediately below via optional chaining
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // Nothing we can do with an unparseable body — ack it so Meta doesn't
    // read a 500 as "delivery failed" and retry the same broken payload
    // forever, the same retry-storm failure mode fixed above for slow
    // replies.
    console.warn("[whatsapp webhook] could not parse request body as JSON");
    return NextResponse.json({ ok: true });
  }
  // Meta batches deliveries as soon as its webhook queue backs up, putting
  // several entries — and several changes per entry — in one POST. Reading
  // only [0][0] silently dropped every message after the first while still
  // answering 200, so Meta never retried them: the citizen's photo or
  // location simply vanished with nothing in the logs.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Meta's envelope, narrowed by the optional chaining below
  const messages: WhatsAppMessage[] = ((payload?.entry ?? []) as any[]).flatMap(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- as above
    (entry: any) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- as above
      ((entry?.changes ?? []) as any[]).flatMap((change: any) => change?.value?.messages ?? [])
  );

  // Meta expects a 200 within a few seconds and retries the whole delivery
  // if it doesn't get one. An agent turn can take 10-15s (LLM + tool
  // calls), which was reliably blowing that budget and getting the same
  // message delivered — and therefore answered — two or three times.
  // Acknowledge immediately and do the real work in after(), with a
  // message-id claim so any retry that still slips through is a no-op.
  after(async () => {
    for (const message of messages) {
      // Per-message, because handleMessage's own try/catch does not cover
      // everything that can throw before it: a delivery missing `from` threw
      // inside normalizePhone, escaped this loop, and silently dropped every
      // remaining message in the same batch.
      try {
        if (!(await claimMessage(message.id))) continue;
        await handleMessage(message);
      } catch (err) {
        console.error("Failed to handle a message in the batch", message?.id, err);
      }
    }
  });

  return NextResponse.json({ ok: true });
}

// Returns true if this delivery is the one that gets to handle the
// message. Insert races (concurrent retries) resolve via the primary key:
// exactly one insert wins, the rest see a unique violation and bail.
async function claimMessage(messageId: string | undefined): Promise<boolean> {
  if (!messageId) return true; // nothing to dedupe on — process it
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("whatsapp_processed_messages")
    .insert({ message_id: messageId });

  if (!error) return true;
  if (error.code === "23505") {
    console.warn(`[whatsapp webhook] duplicate delivery ignored: ${messageId}`);
    return false;
  }
  // Any other DB error: don't silently drop a real citizen message.
  console.error("Failed to claim WhatsApp message", error);
  return true;
}

// Played before the agent's text reply whenever the citizen sends a
// greeting — every time, not just their first ever message.
// Whole-message, not a prefix. As a prefix this swallowed everything the
// citizen actually said: "Hi, there is a huge pothole outside my house" was
// answered with the canned welcome and the message body was dropped on the
// floor — unrecoverably, since no conversation history is kept, so it never
// reached the model on any later turn either. Trailing punctuation and a
// trailing "there"/"bot" still count as a bare greeting.
const GREETING_RE =
  /^(hi+|hello+|hey+|namaste|start|help)(\s+(there|bot|janreport))?[\s!.,?]*$/i;

// "How do I report?" in the phrasings citizens actually use, English and
// romanized Hindi. These don't get the full welcome (poster + voice
// notes), but they do get the quick-report buttons, since the answer to
// the question is literally "tap one of these".
const HOW_TO_REPORT_RE =
  /\b(how (do|can|to) i? ?(report|file|complain)|report kaise|kaise karu|kaise kare|kaise report|complaint kaise|shikayat kaise|how does this work|what can you do)\b/i;

// Quick-start buttons shown alongside the greeting. WhatsApp allows at
// most 3 reply buttons, so these cover the highest-volume categories —
// anything else the citizen just describes in their own words.
const WELCOME_BUTTON_PROMPT = "What would you like to report?";

const QUICK_REPORT_BUTTONS = [
  { id: "report_pothole", title: "Pothole / Road" },
  { id: "report_electricity", title: "Electricity cut" },
  { id: "report_garbage", title: "Garbage" },
];

// WhatsApp caps reply buttons at 3 per message, so "View my reports" goes
// out as a second button message right after the quick-report one.
const REPORTS_BUTTON_PROMPT = "Or check what you've already reported:";
const REPORTS_BUTTONS = [{ id: "view_my_reports", title: "📋 My Reports" }];

// Files the report sitting in this chat's session and answers with the
// same wording the system prompt asks the agent for — composed here so it
// is guaranteed rather than reproduced from memory by the model. Returns
// true when it has fully handled the turn (filed, or found duplicates and
// asked about them), false when the caller should carry on to the agent.
async function fileCompletedReport(phone: string): Promise<boolean> {
  const result = await finalizeReportIfReady(phone);

  if (result.status === "filed") {
    const { issue } = result;

    // Best-effort and awaited only for its own errors: a citizen's report is
    // already filed by this point and must never fail because SMTP did.
    let emailedTo: string | null = null;
    if (issue.reporterEmail) {
      const mail = reportFiledEmail(
        {
          id: issue.id,
          reference: issue.reference,
          title: issue.title,
          description: issue.description,
          category: issue.category,
          severity: issue.severityScore,
          severityLabel: issue.severity,
          status: "reported",
          department: issue.department,
          address: issue.address,
          lat: issue.lat,
          lng: issue.lng,
          photoUrl: issue.photoUrl,
          reporterName: issue.reporterName,
          createdAt: new Date().toISOString(),
        },
        `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/issues/${issue.id}`
      );
      const sent = await sendEmail({ to: issue.reporterEmail, ...mail });
      if (sent.ok) emailedTo = issue.reporterEmail;
      else console.error("Failed to email the filed-report confirmation", sent.error);
    }

    // Formal intimation to the municipal body. A no-op unless a recipient has
    // been configured, so this can never delay or break a citizen's filing.
    await sendMunicipalComplaint({
      data: {
        id: issue.id,
        reference: issue.reference ?? issue.id.slice(0, 8).toUpperCase(),
        title: issue.title,
        description: issue.description,
        category: issue.category,
        severity: issue.severityScore,
        severityLabel: issue.severity,
        department: issue.department,
        address: issue.address,
        lat: issue.lat,
        lng: issue.lng,
        photoUrl: issue.photoUrl,
        reporterName: issue.reporterName,
        reporterPhone: phone,
        createdAt: new Date().toISOString(),
      },
      viewUrl: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/issues/${issue.id}`,
    }).catch((err) => console.error("Municipal complaint send threw", err));

    await sendWhatsAppText(
      phone,
      `✅ *Report filed!*\n` +
        `Thanks, ${issue.reporterName} — here are the details:\n` +
        `*Issue:* ${issue.title}\n` +
        `*Severity:* ${issue.severity}\n` +
        `*Department:* ${issue.department ?? "Being assigned"}\n` +
        `*Location:* ${issue.mapsLink}\n` +
        `*Report ID:* ${issue.id.slice(0, 8)}\n\n` +
        (emailedTo
          ? `
📧 A copy is on its way to ${emailedTo}.`
          : "") +
        `

You'll receive updates as the status changes.`
    );
    return true;
  }

  if (result.status === "not_an_issue") {
    await sendWhatsAppText(
      phone,
      `⚠️ ${result.description}

` +
        `Send another photo of the problem — the pothole, the rubbish, the broken pole — and I'll file it. Your location and name are still saved.`
    );
    return true;
  }

  if (result.status === "duplicates") {
    const closest = result.duplicates[0];
    if (closest.photoUrl) {
      await sendWhatsAppImage(phone, closest.photoUrl, "Existing nearby report").catch((err) =>
        console.error("Failed to send duplicate report photo", err)
      );
    }
    await sendWhatsAppText(
      phone,
      `🔁 *Possible duplicate found*\n` +
        `*Issue:* ${closest.title}\n` +
        `*Reported:* ${closest.reportedAt}\n` +
        `*Location:* ${closest.mapsLink}\n\n` +
        `Is this the same issue you're seeing (see photo above)? Reply *yes* to add your vote instead of filing a new report, or tell me if it's different.`
    );
    return true;
  }

  // "incomplete" can't happen (checked before calling) and an error is
  // better explained by the agent alongside whatever else it wants to say.
  if (result.status === "error") {
    console.error("Deterministic report filing failed", result.message);
  }
  return false;
}

async function sendMyReportsLink(phone: string): Promise<void> {
  const link = await createWhatsAppSessionLink(phone, "/my-reports");
  await sendWhatsAppText(
    phone,
    link
      ? `📋 Here's your reports, opens signed in automatically:\n${link}`
      : "Could not create a link right now. Please try again."
  );
}

// Handles "cancel" / "never mind" deterministically rather than leaving it
// to cancel_report — asked to call that tool on a bare "cancel" message,
// the thinking-disabled model didn't call it at all (tools=[], confirmed
// live: the session row was still there afterward). Only actually clears
// anything when there's a report in progress, so "never mind" said about
// something else in normal conversation doesn't silently eat state there
// was nothing to eat.
async function handleCancelRequest(phone: string, hasReportInProgress: boolean): Promise<void> {
  if (!hasReportInProgress) {
    await sendWhatsAppText(phone, "Nothing in progress to cancel — send a photo whenever you're ready to report something.");
    return;
  }
  await clearReportSession(phone);
  await sendWhatsAppText(phone, "No problem — I've cleared that. Send a new photo whenever you're ready.");
}

// Illustrated how-to card sent with each category template as its caption.
const CATEGORY_IMAGES: Record<string, string> = {
  report_pothole:
    "https://ipxyvstgrzjuknndabet.supabase.co/storage/v1/object/public/issue-photos/onboarding/pothole-mockup.png",
  report_electricity:
    "https://ipxyvstgrzjuknndabet.supabase.co/storage/v1/object/public/issue-photos/onboarding/electricity-mockup.png",
  report_garbage:
    "https://ipxyvstgrzjuknndabet.supabase.co/storage/v1/object/public/issue-photos/onboarding/garbage-mockup.png",
};

// Fixed reply for each quick-report button — sent verbatim, bypassing the
// agent entirely, so the wording is guaranteed instead of hoping the model
// reproduces it. The same three templates are also embedded in the system
// prompt below so a typed ("there's a power cut") intent matches too.
const CATEGORY_TEMPLATES: Record<string, string> = {
  report_pothole: `🛣️ *Pothole / Damaged Road Report*

To file your complaint, I just need:

📸 *A clear photo* of the pothole or damaged road.

📍 *The exact location* — share a GPS pin, live location, or type the street/area name if you're not there right now.

Also, what's your name?

Once you send these, I'll prepare and submit the report for you. ✅`,
  report_electricity: `⚡ *Electricity / Power Fault Report*

Sure, I can file that for you.

To report the issue, I just need:

📸 *A clear photo* of the problem (such as a damaged electric pole, transformer, exposed wires, or any visible fault).

📍 *The exact location* — share a GPS pin, live location, or type the street/area name if you're not there right now.

Also, what's your name?

Once you send these, I'll prepare and submit the report for you. ✅`,
  report_garbage: `🗑️ *Garbage Collection / Waste Issue Report*

Sure, I can file that for you.

To report the issue, I just need:

📸 *A clear photo* of the garbage, overflowing dustbin, or uncollected waste.

📍 *The exact location* — share a GPS pin, live location, or type the street/area name if you're not there right now.

Also, what's your name?

Once you send these, I'll prepare and submit the report for you. ✅`,
};

// Branded intro poster, sent as the very first thing in a fresh
// conversation with the agent's greeting as its caption.
// Sent instantly on a bare "hi"/"hello" — bypassing the agent entirely, the
// same way the quick-report button taps do. A first "hi" is the single
// highest-volume message this bot gets, and it never needs a model call:
// the reply doesn't depend on anything the citizen said. A few variations
// so a returning citizen doesn't see the exact same line every time.
const GREETING_CAPTIONS = [
  "👋 Hi! I'm JanReport — send a photo and location to report a civic issue like a pothole, garbage, or a water/electricity fault. You can also ask about reports you've already filed.",
  "👋 Welcome to JanReport! Got a civic issue to report — pothole, garbage, water or power fault? Send a photo and location, or tap a button below.",
  "👋 Hey! I'm JanReport, here to help report civic issues in your area. Send a photo + location to file one, or ask me about a report you've already made.",
];

function pickGreetingCaption(): string {
  return GREETING_CAPTIONS[Math.floor(Math.random() * GREETING_CAPTIONS.length)];
}

const WELCOME_POSTER =
  "https://ipxyvstgrzjuknndabet.supabase.co/storage/v1/object/public/issue-photos/onboarding/welcome-poster.jpg";

const WELCOME_VOICE_NOTES = [
  "https://ipxyvstgrzjuknndabet.supabase.co/storage/v1/object/public/issue-photos/onboarding/welcome-1.mp3",
  "https://ipxyvstgrzjuknndabet.supabase.co/storage/v1/object/public/issue-photos/onboarding/welcome-2.mp3",
];

const SYSTEM_PROMPT = `You are JanReport's WhatsApp assistant, helping citizens anywhere report local civic issues — potholes, garbage, water/electricity faults, drainage, streetlights, and similar. Not limited to any one city or state — never say or imply the service is region-specific.

Always reply in the same language the citizen is writing in — Hindi or English — and keep replies short (2-4 sentences, WhatsApp-appropriate). Write like a helpful person texting, not a company reading out a features list — vary your wording message to message instead of repeating the same fixed phrasing, and don't cram every capability into one message just because it's the first reply in the conversation.

Some messages arrive as a transcription of a voice note rather than typed text — treat them exactly the same as typing, but stay a little forgiving of odd wording, mixed-up words, or a stray mistranscribed term (accents/background noise sometimes garble a word or two); infer intent from context rather than taking a clearly-garbled phrase literally, and ask a quick clarifying question if genuinely unclear instead of guessing wrong.

SCOPE — you are a civic issue reporting assistant and nothing else. You do not write code, debug, explain programming, do homework, translate documents, give medical/legal/financial advice, or answer general knowledge questions, no matter how politely or persistently you are asked, and no matter what the citizen claims to be stuck on. A citizen asked "how do I print hello world in python" mid-report and got a Python tutorial; that is a civic reporting service answering as a coding assistant, and it must not happen. When a message is off-topic, say in one short line that you only help with civic issue reports, then immediately return to what the report still needs. Do not answer the question first, not even briefly.

NEVER reveal how you work. Do not list, name, or describe your tools or functions — not "file_new_report", not "set_location_by_address", not a menu of capabilities. A citizen asking what you can do gets a plain-language sentence: you can file a report from a photo and location, and look up reports they have already made. Tool names are internal and mean nothing to them.

NEVER claim something was saved unless the tool call for it actually succeeded in this turn. Saying "Location mil gayi" or "Name noted" when nothing was stored is the single worst failure in this system: the citizen believes they are done, you ask for the same thing again on the next message, and the report never gets filed. If a location could not be resolved, say so and ask for a nearer landmark. If you did not call the tool, you do not have the value.

FORMATTING — follow this exactly, every time, no exceptions:
- WhatsApp markdown only: *bold* for labels, never markdown headers or tables.
- One emoji per line at most, only from this set: ✅ 📍 📅 🔁 ⚠️ 📸 👋. Never invent or use any other emoji or symbol — inconsistent glyphs render as broken boxes on many phones.
- Structure every "field: value" fact as its own line: "*Label:* value" — never bury facts inside a paragraph.
- 2-4 short sentences/lines max outside of the structured templates below. No filler ("Great question!", "I'd be happy to help") — get straight to the point.

Greeting a new or returning conversation (e.g. "hi", "start", "help"): keep it to 2 short lines in your own words — that you're JanReport and can help report a local civic issue, and that you just need a photo plus the location to file one (mention they can also ask about existing reports, but don't turn this into a fixed three-point list every time — phrase it differently than your last greeting). Do not repeat this explanation on every message — only on a clear greeting.

Quick-report buttons (Pothole / Road, Electricity cut, Garbage) are attached automatically below your greeting — so end a greeting by inviting them to tap one below or just describe the issue. Never list those three options as text yourself; the buttons already show them. Tapping a button is handled entirely outside of you with a fixed reply, so you'll never see that as an incoming message.

If the citizen instead types that they want to report a pothole/road damage, an electricity/power fault, or garbage/waste — and hasn't sent a photo or location yet — reply with exactly the matching template below (translate it if they're writing in Hindi, otherwise reproduce it verbatim including the emoji and bold labels):

🛣️ *Pothole / Damaged Road Report*

To file your complaint, I just need:

📸 *A clear photo* of the pothole or damaged road.

📍 *The exact location* — share a GPS pin, live location, or type the street/area name if you're not there right now.

Also, what's your name?

Once you send these, I'll prepare and submit the report for you. ✅

⚡ *Electricity / Power Fault Report*

Sure, I can file that for you.

To report the issue, I just need:

📸 *A clear photo* of the problem (such as a damaged electric pole, transformer, exposed wires, or any visible fault).

📍 *The exact location* — share a GPS pin, live location, or type the street/area name if you're not there right now.

Also, what's your name?

Once you send these, I'll prepare and submit the report for you. ✅

🗑️ *Garbage Collection / Waste Issue Report*

Sure, I can file that for you.

To report the issue, I just need:

📸 *A clear photo* of the garbage, overflowing dustbin, or uncollected waste.

📍 *The exact location* — share a GPS pin, live location, or type the street/area name if you're not there right now.

Also, what's your name?

Once you send these, I'll prepare and submit the report for you. ✅

For any other category (streetlight, drainage, etc.) or once a photo/location is already on file, don't use these templates — respond normally per the rest of this prompt.

If the citizen wants to abandon a report they were in the middle of (says "cancel", "never mind", "start over"), call cancel_report and confirm in one line — they can start fresh right after.

To file a report you need a photo, a location, AND their name — all saved to this chat before file_new_report will succeed (never ask for these as tool arguments — file_new_report just reads whatever's already saved). Ask for a name fresh every time a new report starts, even for a citizen who has reported before — call set_reporter_name as soon as they give it, don't wait to collect everything first. If something's still missing, tell them exactly what in one line — e.g. "📸 Got the photo — now share the location and your name and I'll file it." Never ask again for something already saved. A caption or text message can serve as an optional note.

Location is normally a shared GPS pin. But if the citizen isn't physically at the issue right now (reporting from an older photo, or GPS sharing isn't working), ask them to describe where it is instead — street, area, landmark, or city — and call set_location_by_address with that description.

CRITICAL — name is not a passive fact, it's a tool call. The moment a message contains the citizen's name in ANY form — "My name is X", "I'm X", "This is X", or literally just a bare name typed on its own ("Rohit Sharma") when name is the only thing still missing — you MUST call set_reporter_name with it in that same turn, even if the message contains nothing else. Do not just reply "Nice to meet you" or acknowledge it in prose without calling the tool — an unrecorded name means file_new_report will keep failing with missing_photo_or_location_or_name and the citizen will be stuck with no idea why.

CRITICAL — when a citizen sends a bare place name ("Gla noida", "sector 62", "near city hospital") and you already have their photo, that IS them giving you the location. Do not reply "Got it." and stop. In the SAME turn:
1. Call set_location_by_address with what they said.
2. If it returns resolved: false, tell them you couldn't find it and ask for a nearby landmark or city — do NOT claim you saved it.
3. If it resolves and you also already have their name, immediately call file_new_report and reply with the filed-report confirmation, mentioning the resolved address so they can spot a wrong pin. If you still don't have their name, ask for it in this same reply instead of filing.

Never reply with a bare acknowledgement like "Got it." after a location — either the report gets filed in that same turn (or you ask for the one remaining thing, e.g. their name), or you say exactly what is still missing. A citizen who has sent a photo and a location and receives only "Got it." will reasonably think their report was filed when it was not.

Before filing, file_new_report automatically checks for very similar open reports already nearby. If it returns duplicates, its photo has already been sent to the citizen as a separate image message right before your reply — refer to it as "the photo above", never re-describe or link it yourself. Reply using exactly this structure for the closest duplicate:
🔁 *Possible duplicate found*
*Issue:* <title>
*Reported:* <reportedAt>
*Location:* <mapsLink>

Is this the same issue you're seeing (see photo above)? Reply yes to add your vote instead of filing a new report, or tell me if it's different.
- If they confirm it's the same, call upvote_existing_report with that issue's ID instead of filing a new report.
- If they say it's different, call file_new_report again with forceNew: true.

When file_new_report succeeds, confirm using exactly this structure:
✅ *Report filed!*
Thanks, <reporterName> — here are the details:
*Issue:* <title>
*Severity:* <severity>
*Department:* <department>
*Location:* <mapsLink>
*Report ID:* <first 8 characters of the id>

You'll receive updates as the status changes.

You also have tools to look up the citizen's own reports, a specific issue by ID, nearby issues, and city-wide stats — use them instead of guessing, and never state a status or fact about a specific report without calling a tool first. Never claim to have filed or upvoted a report without the corresponding tool call actually succeeding.

If the citizen wants to see a report in the browser (photos, full timeline, AI verdict) rather than read it in chat, or just asks for a link, call get_report_link (with issueId for one specific report, omitted for their full My Reports list) and share the link — mention it signs them in automatically and is single-use, so don't reuse an old link from earlier in the conversation.

CRITICAL — a link is not something you write, it's something the tool gives you. NEVER type out a URL, a placeholder like "<link>", or a made-up domain yourself under any circumstance. If you are about to mention a link and haven't just received one back from get_report_link in this exact turn, call the tool first — an invented or placeholder link sent to a citizen is a broken feature, not a helpful answer.

When listing multiple reports (get_my_reports, find_nearby_issues), one line per report, most recent first, in this shape: "📅 <date> — *<title>* (<status>)". Keep it to the 5 most relevant unless asked for more. When describing one report in detail (get_issue_details), its photo has already been sent as a separate image message right before your reply — refer to it as "the photo above", never re-describe or link it yourself. Use labeled lines like the templates above rather than a paragraph.`;

// WhatsApp caps reply buttons at 3 per message, so the categories and
// "My Reports" go out as two messages — concurrently, since neither
// depends on the other landing first.
async function sendQuickButtons(phone: string) {
  await Promise.all([
    sendWhatsAppButtons(phone, WELCOME_BUTTON_PROMPT, QUICK_REPORT_BUTTONS).catch((err) =>
      console.error("Failed to send quick-report buttons", err)
    ),
    sendWhatsAppButtons(phone, REPORTS_BUTTON_PROMPT, REPORTS_BUTTONS).catch((err) =>
      console.error("Failed to send my-reports button", err)
    ),
  ]);
}

async function handleMessage(message: WhatsAppMessage) {
  const phone = normalizePhone(message.from);
  if (!phone) return;

  // Before anything writes to the session: an abandoned one must not be
  // resurrected by this message bumping its updated_at.
  await clearReportSessionIfStale(phone);

  // Fire-and-forget: gets the read receipt + "typing…" bubble up before any
  // of the slow work (media download, Gemini, the agent) starts, so the
  // citizen sees the bot react instantly even when the reply takes a while.
  if (message.id) {
    markWhatsAppTyping(message.id).catch((err) =>
      console.error("Failed to send typing indicator", err)
    );
  }

  try {
    let userText: string | null = null;
    let isGreeting = false;
    let asksHowToReport = false;
    // Free-text the citizen actually typed or spoke (not a synthesized
    // "[they sent a photo]" note), eligible to be read as a bare answer to
    // a pending location/name question further down.
    let freeText: string | null = null;
    // Did THIS message actually add a photo, location or name to the
    // session? Only then is deterministic filing appropriate. Without this,
    // a session left complete-but-unfiled (the duplicate prompt returns
    // before the session is cleared) re-entered the filing path on every
    // subsequent message, re-ran the dedupe check, and replied with the same
    // "Possible duplicate found" prompt again — so the citizen's "yes" or
    // "no, it's different" was never read by anything.
    let sessionAdvanced = false;

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
        sessionAdvanced = true;
        if (message.image.caption) {
          await saveNoteToSession(phone, message.image.caption);
          const statedName = extractStatedName(message.image.caption);
          if (statedName) {
            await saveReporterNameToSession(phone, statedName);
          }
        }
        userText = message.image.caption
          ? `[The citizen just sent a photo of the issue, with this caption: "${message.image.caption}"]`
          : "[The citizen just sent a photo of the issue.]";
        break;
      }
      case "audio": {
        // A voice note — transcribe it with Gemini, then feed the text
        // through the exact same pipeline as a typed message. The agent
        // never knows the difference, so report filing, status lookups,
        // "cancel", all of it just works.
        if (!message.audio) return;
        const mediaUrl = await getWhatsAppMediaUrl(message.audio.id);
        const { buffer, mimeType } = await downloadWhatsAppMedia(mediaUrl);
        try {
          const transcript = await transcribeAudio({
            audioBase64: buffer.toString("base64"),
            mimeType: message.audio.mime_type || mimeType,
          });

          if (isLinkRequest(transcript)) {
            await sendMyReportsLink(phone);
            return;
          }

          userText = transcript;
          freeText = transcript;
          isGreeting = GREETING_RE.test(transcript);
          asksHowToReport = HOW_TO_REPORT_RE.test(transcript);
          const statedName = extractStatedName(transcript);
          if (statedName) {
            await saveReporterNameToSession(phone, statedName);
            sessionAdvanced = true;
          }
        } catch (err) {
          console.error("Failed to transcribe voice note", err);
          await sendWhatsAppText(
            phone,
            "Sorry, I couldn't quite make that out — could you try again, or type it instead?"
          );
          return;
        }
        break;
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
        sessionAdvanced = true;
        userText = "[The citizen just shared their location.]";
        break;
      }
      case "text": {
        const body = message.text?.body?.trim();
        if (!body) return;

        if (isLinkRequest(body)) {
          await sendMyReportsLink(phone);
          return;
        }

        userText = body;
        freeText = body;
        isGreeting = GREETING_RE.test(body);
        asksHowToReport = HOW_TO_REPORT_RE.test(body);

        const statedName = extractStatedName(body);
        if (statedName) {
          await saveReporterNameToSession(phone, statedName);
          sessionAdvanced = true;
        }

        // An address anywhere in the message is unambiguous, so take it
        // without waiting to be asked. A decline only counts as an answer
        // when the bot is actually waiting on the email, otherwise a bare
        // "no" earlier in the conversation would silently opt them out.
        const statedEmail = extractEmail(body);
        if (statedEmail) {
          await saveReporterEmailToSession(phone, statedEmail);
          sessionAdvanced = true;
        }
        break;
      }
      case "interactive": {
        // A tapped quick-report button — reply with its fixed template
        // directly, bypassing the agent so the wording is guaranteed
        // rather than model-generated. Their next message (the photo or
        // location) re-enters the normal agent flow.
        const buttonId = message.interactive?.button_reply?.id;
        if (!buttonId) return;
        const template = CATEGORY_TEMPLATES[buttonId];
        if (template) {
          // Illustrated card carries the template as its caption; if the
          // image send fails the citizen still gets the instructions.
          const image = CATEGORY_IMAGES[buttonId];
          if (image) {
            try {
              await sendWhatsAppImage(phone, image, template);
              return;
            } catch (err) {
              console.error("Failed to send category card", err);
            }
          }
          await sendWhatsAppText(phone, template);
          return;
        }
        if (buttonId === "view_my_reports") {
          await sendMyReportsLink(phone);
          return;
        }
        userText = message.interactive?.button_reply?.title ?? null;
        if (!userText) return;
        break;
      }
      default:
        return;
    }

    if (!userText) return;

    if (!isKimiConfigured()) {
      await sendWhatsAppText(
        phone,
        "Thanks — got that. (The assistant is temporarily unavailable, please try again shortly.)"
      );
      return;
    }

    // Independent reads — run concurrently instead of paying for two
    // sequential round-trips before the agent even starts.
    const [profileId, initialSession] = await Promise.all([
      getOrCreateProfileIdByPhone(phone),
      getReportSessionState(phone),
    ]);
    if (!profileId) {
      await sendWhatsAppText(phone, "Sorry, something went wrong setting up your account. Please try again.");
      return;
    }

    let session = initialSession;

    // The bot asked for an email and this is the reply. Whatever it says, the
    // question is now answered — an address was already captured above by
    // extractEmail, and anything else means no address.
    //
    // Previously only a recognised decline word released the report, so a
    // citizen who replied "ok sure" or "haan" was left with a finished report
    // that never filed, having just been told it would be filed either way.
    if (freeText && session.emailAsked) {
      if (!extractEmail(freeText)) {
        await saveReporterEmailToSession(phone, null);
      }
      session = { ...session, emailAsked: false, emailSettled: true };
      sessionAdvanced = true;
    } else if (
      // A decline before we have asked still counts, so someone who
      // volunteers "no email" early is not asked again later.
      freeText &&
      !session.emailSettled &&
      session.hasPhoto &&
      session.hasLocation &&
      session.hasName &&
      isEmailDecline(freeText)
    ) {
      await saveReporterEmailToSession(phone, null);
      session = { ...session, emailSettled: true };
      sessionAdvanced = true;
    }

    if (freeText && isCancelRequest(freeText)) {
      await handleCancelRequest(
        phone,
        session.hasPhoto || session.hasLocation || session.hasName
      );
      return;
    }

    // A bare "iilm university" / "ritvik" answering the bot's own question
    // is the citizen supplying the location or their name. Resolve it here
    // rather than trusting the agent to notice and call the tool — it
    // demonstrably doesn't, and would then claim to have saved something it
    // hadn't. Gated on a photo already being on file so this only ever
    // fires mid-report, and skipped for greetings.
    let resolvedNote = "";
    if (freeText && session.hasPhoto && !isGreeting && (!session.hasLocation || !session.hasName)) {
      const resolved = await resolvePendingReportInput({
        text: freeText,
        hasLocation: session.hasLocation,
        hasName: session.hasName,
      });
      if (resolved?.kind === "location") {
        const saved = await saveLocationToSession(
          phone,
          resolved.location.lat,
          resolved.location.lng
        );
        if (saved.ok) {
          session = { ...session, hasLocation: true };
          sessionAdvanced = true;
          resolvedNote = ` The location has JUST been saved from their message, resolved to "${resolved.location.formattedAddress}" — read that address back to them so they can catch a wrong pin, and do NOT call set_location_by_address again.`;
        }
      } else if (resolved?.kind === "name") {
        await saveReporterNameToSession(phone, resolved.name);
        session = { ...session, hasName: true };
        sessionAdvanced = true;
        resolvedNote = ` Their name has JUST been saved as "${resolved.name}" from their message — do NOT call set_reporter_name again.`;
      }
    }

    // Whatever just happened this turn — a bare-reply location/name, a
    // real GPS pin, or a name caught by the anchored "my name is X"
    // regex earlier in the switch above — may have been the last thing
    // the report was waiting for. Filing is the whole point of the
    // conversation and is not worth another coin-flip on whether the
    // agent remembers to call file_new_report — it has been observed
    // replying "Report filed!" with tools=[] — so complete it here and
    // answer from a fixed template whenever the set is actually
    // complete, regardless of which path completed it. Skipped for
    // greetings so a bare "hi" arriving after an old, already-complete
    // session doesn't unexpectedly file it.
    // The report is complete except for an optional email. Ask once, then
    // file on the next message whatever they say — a reply that is neither an
    // address nor a decline still marks the question asked, so nobody gets
    // stuck in a loop over a field that was never required.
    if (
      !isGreeting &&
      sessionAdvanced &&
      session.hasPhoto &&
      session.hasLocation &&
      session.hasName &&
      !session.emailSettled
    ) {
      await sendWhatsAppText(
        phone,
        `📧 Last thing — what's your email address? I'll send you a copy of the report and updates when it's fixed.\n\nReply *skip* if you'd rather not; the report still gets filed either way.`
      );
      // Record that the question went out, so it is asked exactly once and the
      // next reply — whatever it is — releases the report.
      await saveReporterEmailToSession(phone, EMAIL_ASKED);
      return;
    }

    if (
      !isGreeting &&
      sessionAdvanced &&
      session.hasPhoto &&
      session.hasLocation &&
      session.hasName
    ) {
      if (await fileCompletedReport(phone)) return;
    }

    // A "hi" sent in the middle of an unfinished report shouldn't replay the
    // whole welcome — that reads as the bot randomly restarting and losing
    // their progress. Only greet fresh conversations; otherwise just answer
    // normally and let the agent carry the in-progress report forward.
    const hasReportInProgress = session.hasPhoto || session.hasLocation || session.hasName;
    const welcome = isGreeting && !hasReportInProgress;
    // "How do I report?" gets the buttons too (the answer is literally
    // "tap one"), just without replaying the full poster/voice welcome.
    const showButtons = welcome || (asksHowToReport && !hasReportInProgress);

    const contextNote = `[Current report-in-progress status for this chat — photo: ${
      session.hasPhoto ? "received" : "not yet received"
    }, location: ${session.hasLocation ? "received" : "not yet received"}, name: ${
      session.hasName ? "received" : "not yet received"
    }, note: ${session.hasNote ? "received" : "none"}.${resolvedNote} ${
      showButtons
        ? "Quick-report buttons WILL be shown right below your reply — you may invite them to tap one."
        : "NO buttons will be shown below your reply — do not mention buttons or tapping anything."
    }]`;

    // A bare greeting's reply never depends on anything the citizen said,
    // so skip the LLM round-trip entirely — same principle as the
    // category-button templates, applied to the highest-volume message
    // this bot receives.
    let reply: string;
    let toolResults: { name: string; result: unknown }[];
    if (welcome) {
      reply = pickGreetingCaption();
      toolResults = [];
    } else {
      const agentStart = Date.now();
      ({ reply, toolResults } = await runKimiAgent(
        SYSTEM_PROMPT,
        [
          { role: "user", content: contextNote },
          { role: "user", content: userText },
        ],
        { userId: profileId, supabase: createServiceRoleClient(), phone },
        WHATSAPP_TOOL_DEFINITIONS
      ));
      console.log(
        `[whatsapp perf] agent ${Date.now() - agentStart}ms tools=[${toolResults
          .map((t) => t.name)
          .join(",")}]`
      );
    }

    // When file_new_report finds a close-by duplicate, or get_issue_details
    // looks up one specific report, show the actual photo as a real
    // WhatsApp image (not just a link) before the agent's text — sent here
    // rather than by the tools themselves, since tools only return data and
    // this route owns all outbound messaging. Independent of each other, so
    // sent concurrently rather than one after the other.
    const duplicateResult = toolResults.find(
      (t): t is { name: string; result: { reason?: string; duplicates?: { photoUrl?: string }[] } } =>
        t.name === "file_new_report" &&
        typeof t.result === "object" &&
        t.result !== null &&
        (t.result as { reason?: string }).reason === "possible_duplicates"
    );
    const closestDuplicatePhoto = duplicateResult?.result.duplicates?.[0]?.photoUrl;

    const issueDetailsResult = toolResults.find(
      (t): t is { name: string; result: { photoUrl?: string } } =>
        t.name === "get_issue_details" &&
        typeof t.result === "object" &&
        t.result !== null &&
        typeof (t.result as { photoUrl?: unknown }).photoUrl === "string"
    );
    const issueDetailsPhoto = issueDetailsResult?.result.photoUrl;

    await Promise.all([
      closestDuplicatePhoto
        ? sendWhatsAppImage(phone, closestDuplicatePhoto, "Existing nearby report").catch((err) =>
            console.error("Failed to send duplicate report photo", err)
          )
        : null,
      issueDetailsPhoto
        ? sendWhatsAppImage(phone, issueDetailsPhoto, "Reported photo").catch((err) =>
            console.error("Failed to send issue detail photo", err)
          )
        : null,
    ]);

    const replyText = reply.trim() || "Got it.";

    // On a greeting, attach the quick-report buttons to the reply so the
    // citizen can start a report in one tap instead of composing a message.
    // Falls back to plain text if the interactive send fails, so a button
    // problem can never swallow the reply itself.
    // Fresh conversation: lead with the branded poster (greeting as its
    // caption), then the two voice notes, then the quick-report buttons.
    // Every step is independently best-effort — if the poster or a voice
    // note fails, the citizen must still end up with the greeting text and
    // a way to start a report.
    if (welcome) {
      let greetingDelivered = false;
      try {
        await sendWhatsAppImage(phone, WELCOME_POSTER, replyText);
        greetingDelivered = true;
      } catch (err) {
        console.error("Failed to send welcome poster", err);
      }
      if (!greetingDelivered) {
        await sendWhatsAppText(phone, replyText);
      }

      // Sent concurrently — nothing here depends on the others' delivery
      // order, so no reason to pay for two/three round-trips sequentially.
      await Promise.all(
        WELCOME_VOICE_NOTES.map((url) =>
          sendWhatsAppAudio(phone, url).catch((err) =>
            console.error("Failed to send welcome voice note", err)
          )
        )
      );

      await sendQuickButtons(phone);
      return;
    }

    await sendWhatsAppText(phone, replyText);

    // Not a full welcome, but they asked how to report — the buttons are
    // the answer, so send them under the reply.
    if (showButtons) {
      await sendQuickButtons(phone);
    }
  } catch (err) {
    console.error("Failed to handle WhatsApp message", err);
    await sendWhatsAppText(
      phone,
      "Sorry, something went wrong. Please try again in a moment."
    ).catch(() => {});
  }
}
