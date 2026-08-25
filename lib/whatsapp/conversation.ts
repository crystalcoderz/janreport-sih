import { createServiceRoleClient } from "@/lib/supabase/server";

// Short-term memory for the WhatsApp bot.
//
// Every message used to be handled in isolation: the agent was called with the
// current text and nothing else. So a citizen who asked "can I see my report",
// got a list back and answered "Today one" was sending a fragment into a void.
// The model had no idea what "Today one" referred to, and with no context to
// work from it fell back on introducing itself -- which reads as the bot
// forgetting the conversation mid-sentence. "Yes", "24 august" and every other
// natural follow-up failed the same way, and one of them was even caught by the
// off-topic guardrail, because on its own "24 august" really does look like a
// question about dates.
//
// Turns are kept per phone number, and only for a while: an answer to a
// question asked yesterday is not context, it is confusion. Beyond the window
// the citizen is starting a new conversation and should get a fresh one.

const HISTORY_WINDOW_MINUTES = 60;
/** Messages, not exchanges — 12 is roughly six back-and-forths. */
const HISTORY_MAX_MESSAGES = 12;
/** Long enough for a listing of reports, short enough not to bloat the prompt. */
const MAX_CONTENT_CHARS = 2000;
/** Rows kept per phone; older ones are pruned on write so the table stays small. */
const KEEP_PER_PHONE = 30;

export type TurnRole = "user" | "assistant";
export interface ConversationTurn {
  role: TurnRole;
  content: string;
}

/**
 * The recent conversation for this number, oldest first, ready to prepend to
 * the agent's messages.
 *
 * Best-effort: a lookup failure costs context, not the reply, so it returns an
 * empty history rather than throwing into the message handler.
 */
export async function loadRecentTurns(phone: string): Promise<ConversationTurn[]> {
  const supabase = createServiceRoleClient();
  const since = new Date(Date.now() - HISTORY_WINDOW_MINUTES * 60_000).toISOString();

  const { data, error } = await supabase
    .from("whatsapp_conversation_turns")
    .select("role, content")
    .eq("phone", phone)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(HISTORY_MAX_MESSAGES);

  if (error) {
    console.error("[conversation] could not load history", error);
    return [];
  }

  // Fetched newest-first so the limit keeps the most recent messages; the
  // model wants them chronological.
  return ((data ?? []) as ConversationTurn[]).reverse();
}

/**
 * Append one message to the conversation.
 *
 * Best-effort for the same reason: failing to remember a turn must never stop
 * the citizen getting their reply.
 */
export async function recordTurn(
  phone: string,
  role: TurnRole,
  content: string
): Promise<void> {
  const trimmed = content?.trim();
  if (!trimmed) return;

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("whatsapp_conversation_turns").insert({
    phone,
    role,
    content: trimmed.slice(0, MAX_CONTENT_CHARS),
  });
  if (error) console.error("[conversation] could not record a turn", error);
}

/**
 * Drop everything remembered for this number.
 *
 * Called when a report is filed or cancelled: the exchange that led there is
 * finished, and carrying it into the next conversation would have the bot
 * answering a question the citizen has moved on from.
 */
export async function clearConversation(phone: string): Promise<void> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("whatsapp_conversation_turns")
    .delete()
    .eq("phone", phone);
  if (error) console.error("[conversation] could not clear history", error);
}

/**
 * Keep the table from growing without bound.
 *
 * Deletes anything for this number beyond the newest KEEP_PER_PHONE rows.
 * Cheap because of the (phone, created_at desc) index, and only the service
 * role ever touches this table.
 */
export async function pruneConversation(phone: string): Promise<void> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("whatsapp_conversation_turns")
    .select("id")
    .eq("phone", phone)
    .order("created_at", { ascending: false })
    .range(KEEP_PER_PHONE, KEEP_PER_PHONE + 200);

  if (error || !data || data.length === 0) return;
  const ids = (data as { id: number }[]).map((r) => r.id);
  await supabase.from("whatsapp_conversation_turns").delete().in("id", ids);
}
