import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { kimiChat, isKimiConfigured } from "@/lib/kimi/client";
import { computeCityStats, formatCityStatsForPrompt } from "@/lib/analytics";

export async function POST() {
  if (!isKimiConfigured()) {
    return NextResponse.json(
      { error: "AI briefing is not configured (missing KIMI_API_KEY)." },
      { status: 503 }
    );
  }

  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createClient();
  const [issuesRes, departmentsRes, resolvedHistoryRes] = await Promise.all([
    supabase.from("issues").select("*"),
    supabase.from("departments").select("*"),
    supabase
      .from("issue_status_history")
      .select("issue_id, changed_at")
      .eq("status", "resolved"),
  ]);

  // Worse here than on the page: a failed query would hand the model an
  // all-zero city and it would write a fluent, confident briefing about a
  // town with no problems, which an admin has no way to tell from a real one.
  const loadError = issuesRes.error ?? departmentsRes.error ?? resolvedHistoryRes.error;
  if (loadError) {
    console.error("Briefing stats query failed", loadError);
    return NextResponse.json(
      { error: "Could not read city statistics. Please try again shortly." },
      { status: 503 }
    );
  }

  const stats = computeCityStats(
    issuesRes.data ?? [],
    departmentsRes.data ?? [],
    resolvedHistoryRes.data ?? []
  );

  try {
    const briefing = await kimiChat(
      [
        {
          role: "system",
          content:
            "You are a civic operations analyst writing a short daily briefing for a municipal administrator on JanReport, a citizen issue-reporting platform for Jharkhand. Given aggregate statistics, write: (1) a 2-3 sentence summary of the current state, (2) a short prioritized list of 2-4 concrete recommendations (which departments need attention, what's trending). Be specific and reference the actual numbers given. Plain text, no markdown headers, keep it under 200 words.",
        },
        {
          role: "user",
          content: formatCityStatsForPrompt(stats),
        },
      ],
      { maxTokens: 500 }
    );

    return NextResponse.json({ briefing: briefing.trim() });
  } catch (err) {
    console.error("Kimi briefing failed", err);
    return NextResponse.json(
      { error: "Could not generate a briefing right now. Please try again." },
      { status: 502 }
    );
  }
}
