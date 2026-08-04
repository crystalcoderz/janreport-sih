import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { kimiChat, isKimiConfigured } from "@/lib/kimi/client";
import { CATEGORY_LABELS, type IssueCategory } from "@/lib/departments";
import type { IssueStatus } from "@/lib/supabase/types";

export async function POST(request: NextRequest) {
  if (!isKimiConfigured()) {
    return NextResponse.json(
      { error: "AI note drafting is not configured (missing KIMI_API_KEY)." },
      { status: 503 }
    );
  }

  const profile = await getCurrentProfile();
  if (!profile || (profile.role !== "officer" && profile.role !== "admin")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const issueId = typeof body?.issueId === "string" ? body.issueId : null;
  const targetStatus = body?.targetStatus as IssueStatus | undefined;
  if (!issueId || !targetStatus) {
    return NextResponse.json(
      { error: "issueId and targetStatus are required" },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const { data: issue } = await supabase
    .from("issues")
    .select("*, departments(name)")
    .eq("id", issueId)
    .single();

  if (!issue) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  }

  const categoryLabel =
    CATEGORY_LABELS[issue.ai_category as IssueCategory] ?? issue.ai_category;

  try {
    const note = await kimiChat([
      {
        role: "system",
        content:
          "You draft short, professional status-update notes for municipal officers resolving citizen-reported civic issues on JanReport. Write in first person as the officer, 1-3 sentences, factual and specific, no greetings or sign-offs. Return only the note text, nothing else.",
      },
      {
        role: "user",
        content: `Issue: ${issue.title}
Category: ${categoryLabel}
Severity: ${issue.ai_severity_label} (${issue.ai_severity}/10)
Description: ${issue.description ?? "N/A"}
Location: ${issue.address ?? `${issue.lat}, ${issue.lng}`}
Department: ${issue.departments?.name ?? "Unassigned"}
Updating status to: ${targetStatus.replace("_", " ")}

Draft the status-update note.`,
      },
    ]);

    return NextResponse.json({ note: note.trim() });
  } catch (err) {
    console.error("Kimi draft-note failed", err);
    return NextResponse.json(
      { error: "Could not draft a note right now. Please try again." },
      { status: 502 }
    );
  }
}
