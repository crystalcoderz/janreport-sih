import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { sendWhatsAppText, isWhatsAppConfigured } from "@/lib/whatsapp/client";
import { sendEmail } from "@/lib/email/client";
import { getIssueContact } from "@/lib/issue-contact";

export const runtime = "nodejs";

const MAX_MESSAGE_CHARS = 900;

// Lets an officer write to the citizen who filed a report.
//
// Every other message this system sends is generated: a status change, a
// resolution notice, a relayed municipal reply. None of them can say "the
// photo is of your own street, not the pothole" or "which end of the lane did
// you mean?". Without this an officer who spots a mistake has no way to say
// so, and the report just sits there wrong.
//
// Delivery is not guaranteed and the officer is told exactly what happened.
// WhatsApp only accepts free-form text within 24 hours of the citizen's last
// message; outside that window Meta rejects it and the only alternative is an
// approved template, which this deployment does not have. Reporting "sent"
// when nothing arrived would be worse than failing.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [{ data: actor }, { data: issue, error: issueError }] = await Promise.all([
    supabase.from("profiles").select("role, department_id").eq("id", user.id).single(),
    supabase
      .from("issues")
      .select("id, reference, title, status, reporter_id, department_id")
      .eq("id", id)
      .single(),
  ]);

  if (issueError || !issue) {
    return NextResponse.json({ error: "Issue not found." }, { status: 404 });
  }

  const authorized =
    actor &&
    (actor.role === "admin" ||
      (actor.role === "officer" && actor.department_id === issue.department_id));
  if (!authorized) {
    return NextResponse.json(
      { error: "You don't have permission to message this citizen." },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const message = String(body?.message ?? "").trim();

  if (!message) {
    return NextResponse.json({ error: "Write a message first." }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return NextResponse.json(
      { error: `Keep it under ${MAX_MESSAGE_CHARS} characters.` },
      { status: 400 }
    );
  }

  const admin = createServiceRoleClient();

  // profiles.phone is withheld from the citizen-facing column grant, so this
  // goes through the service role — same as every other notification path.
  const { data: reporter } = issue.reporter_id
    ? await admin
        .from("profiles")
        .select("phone, full_name")
        .eq("id", issue.reporter_id)
        .maybeSingle()
    : { data: null };

  const reporterEmail = await getIssueContact(admin, issue.id);

  // Prefixed so the citizen can tell a human wrote this, and knows which of
  // their reports it is about — they may have filed several.
  const text =
    `💬 *About your report ${issue.reference ?? ""}*\n` +
    `_${issue.title}_\n\n` +
    `${message}`;

  let whatsapp: "sent" | "failed" | "no_phone" | "not_configured" = "no_phone";
  let whatsappError: string | null = null;

  if (!isWhatsAppConfigured()) {
    whatsapp = "not_configured";
  } else if (reporter?.phone) {
    try {
      await sendWhatsAppText(reporter.phone, text);
      whatsapp = "sent";
    } catch (err) {
      whatsapp = "failed";
      const raw = err instanceof Error ? err.message : String(err);
      // 131047 is Meta's re-engagement error: the 24-hour window has closed.
      // Worth naming, because it is not a fault the officer can fix by
      // retrying and the citizen genuinely did not receive anything.
      whatsappError = raw.includes("131047")
        ? "The citizen hasn't messaged the bot in the last 24 hours, so WhatsApp refused a free-form message."
        : raw.slice(0, 200);
      console.error("[message] WhatsApp send failed", raw);
    }
  }

  let email: "sent" | "failed" | "no_address" = "no_address";
  if (reporterEmail) {
    const res = await sendEmail({
      to: reporterEmail,
      subject: `About your report ${issue.reference ?? ""} — ${issue.title}`,
      text: `${message}\n\n—\nAbout your report: ${issue.title}\nRef: ${issue.reference ?? issue.id}`,
      html:
        `<div style="font:400 15px/23px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#3f3f46;max-width:520px;">` +
        `<div style="font:600 11px;letter-spacing:0.09em;text-transform:uppercase;color:#71717a;padding-bottom:8px;">A message about your report</div>` +
        `<h1 style="margin:0 0 6px;font-size:20px;color:#18181b;">${escapeHtml(issue.title)}</h1>` +
        `<p style="margin:0 0 18px;color:#71717a;font-size:13px;">Ref ${escapeHtml(
          issue.reference ?? issue.id
        )}</p>` +
        `<div style="border-left:2px solid #18181b;padding:2px 0 2px 16px;white-space:pre-wrap;">${escapeHtml(
          message
        )}</div></div>`,
    });
    email = res.ok ? "sent" : "failed";
    if (!res.ok) console.error("[message] email send failed", res.error);
  }

  const delivered = whatsapp === "sent" || email === "sent";

  // Recorded either way. A message an officer believes they sent is part of
  // the report's history even when it did not arrive — otherwise the next
  // person reads the silence as nobody having tried.
  await admin.from("issue_status_history").insert({
    issue_id: issue.id,
    status: issue.status,
    note: delivered
      ? `Message to the citizen: ${message}`
      : `Message to the citizen could not be delivered: ${message}`,
    changed_by: user.id,
  });

  return NextResponse.json({
    delivered,
    whatsapp,
    whatsappError,
    email,
    reporterName: reporter?.full_name ?? null,
  });
}

function escapeHtml(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
