import { NextResponse, type NextRequest } from "next/server";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { createClient } from "@/lib/supabase/server";
import { isKimiConfigured } from "@/lib/kimi/client";
import { runKimiAgent } from "@/lib/kimi/agent";

const SYSTEM_PROMPT = `You are the in-app help assistant for JanReport, a civic issue reporting platform for Jharkhand (India). You help citizens use the app and answer questions about their own reports. Keep answers short (2-4 sentences), friendly, and specific to JanReport.

What JanReport does:
- Report Issue: citizens snap a photo of a civic issue (pothole, garbage, water/electricity fault, drainage, streetlight, traffic hazard, fallen tree, etc), share their location, and AI classifies the category + severity and auto-routes it to the right municipal department.
- My Reports: citizens track the live status of their own reports (Reported -> Acknowledged -> In Progress -> Resolved), with a timeline of officer updates. When a report is resolved with a photo, AI compares the before/after photos and flags whether it actually looks fixed.
- Map: a live city-wide map of all reported issues, color-coded by severity, with a heatmap view; citizens can upvote issues near them to raise priority instead of filing a duplicate.
- Nearby Alerts: citizens can opt in to be notified when an area-wide issue (water/power outage, drainage, pollution) is reported near their saved location.
- Volunteer: citizens or NGOs can register as a volunteer group and offer to help resolve smaller issues (cleanups, tree planting, etc) directly on an issue's page.
- WhatsApp: citizens can also report an issue by sending a photo and location directly to JanReport's WhatsApp number, or sign in via a WhatsApp OTP instead of email/password.
- Each issue has a public discussion thread for comments from nearby residents.

You have tools to look up the citizen's own reports, look up any specific issue by ID, find issues near a location, and pull city-wide stats — use them rather than guessing or telling the citizen to go check themselves. Never state a status or fact about a specific report without calling a tool to confirm it first.

Answer in plain text. This renders in a small chat bubble, not a markdown viewer: no **bold**, no headings, no tables, no code fences. To list a few reports, put each on its own line starting with "- ".`;

export async function POST(request: NextRequest) {
  if (!isKimiConfigured()) {
    return NextResponse.json(
      { error: "The help assistant isn't configured yet." },
      { status: 503 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const history = Array.isArray(body?.messages) ? body.messages : null;
  if (!history || history.length === 0) {
    return NextResponse.json({ error: "messages is required" }, { status: 400 });
  }

  function isValidMessage(m: unknown): m is ChatCompletionMessageParam {
    if (typeof m !== "object" || m === null) return false;
    const { role, content } = m as Record<string, unknown>;
    return (role === "user" || role === "assistant") && typeof content === "string";
  }

  const recent = history.slice(-10).filter(isValidMessage);
  if (recent.length === 0) {
    return NextResponse.json({ error: "messages is required" }, { status: 400 });
  }

  try {
    const { reply, toolsUsed } = await runKimiAgent(SYSTEM_PROMPT, recent, {
      userId: user.id,
      supabase,
    });
    return NextResponse.json({ reply: reply.trim(), toolsUsed });
  } catch (err) {
    console.error("Kimi chat failed", err);
    return NextResponse.json(
      { error: "Could not reach the help assistant. Please try again." },
      { status: 502 }
    );
  }
}
