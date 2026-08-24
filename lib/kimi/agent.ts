import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { kimi, KIMI_MODEL, isKimiConfigured } from "@/lib/kimi/client";
import { BASE_TOOL_DEFINITIONS, executeTool, type ToolContext } from "@/lib/kimi/tools";

// Bounded call -> execute tools -> feed results -> repeat loop. Capped so
// a confused model can't loop forever or run up cost on one request.
const MAX_ITERATIONS = 4;

export interface AgentResult {
  reply: string;
  toolsUsed: string[];
  toolResults: { name: string; result: unknown }[];
}

export async function runKimiAgent(
  systemPrompt: string,
  userMessages: ChatCompletionMessageParam[],
  ctx: ToolContext,
  tools: readonly ChatCompletionTool[] = BASE_TOOL_DEFINITIONS
): Promise<AgentResult> {
  if (!isKimiConfigured() || !kimi) {
    throw new Error("Kimi is not configured (missing KIMI_API_KEY)");
  }

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...userMessages,
  ];
  const toolsUsed: string[] = [];
  const toolResults: { name: string; result: unknown }[] = [];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const completion = await kimi.chat.completions.create({
      model: KIMI_MODEL,
      messages,
      tools: [...tools],
      // kimi-k3 defaults to "max" reasoning effort, which meant it burned
      // several seconds of chain-of-thought deciding how to say "got the
      // photo, now share your location". Disabling thinking cuts a call
      // from ~7s to ~2.2s with no loss of tool-calling accuracy, which is
      // the difference between a chat that feels broken and one that
      // doesn't. Note the model only accepts temperature 0.6 in this mode
      // (and only 1 with thinking on), so the two must change together.
      temperature: 0.6,
      // Generation time scales with tokens produced, and every reply here
      // is a few short lines or one of the fixed templates — 600 was just
      // headroom the model never needed and sometimes filled.
      max_tokens: 400,
      ...({ thinking: { type: "disabled" } } as object),
    });

    const message = completion.choices[0]?.message;
    if (!message) break;

    messages.push(message);

    if (!message.tool_calls || message.tool_calls.length === 0) {
      return { reply: message.content ?? "", toolsUsed, toolResults };
    }

    // Kimi (like OpenAI) can emit non-function tool call variants in
    // principle; this app only ever declares function tools.
    const functionCalls = message.tool_calls.filter((c) => c.type === "function");

    // Run every tool the model asked for concurrently. They're independent
    // (each is a self-contained read/write), so serialising them just
    // stacked their latencies — noticeable when the model fetches, say,
    // reports and city stats in one turn.
    const results = await Promise.all(
      functionCalls.map(async (call) => {
        let args: Record<string, unknown> = {};
        try {
          args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        } catch {
          // Malformed arguments from the model — fall through with {} so
          // the tool gets a chance to report a sane error instead of the
          // whole turn crashing.
        }
        return { call, result: await executeTool(call.function.name, args, ctx) };
      })
    );

    // Appended in the model's original order — tool results must line up
    // with their tool_call_ids regardless of which finished first.
    for (const { call, result } of results) {
      toolsUsed.push(call.function.name);
      toolResults.push({ name: call.function.name, result });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        // `?? null` so a tool that returns undefined yields "null" rather than
        // the literal undefined, which is not valid message content and fails
        // the entire turn.
        content: JSON.stringify(result ?? null),
      });
    }
  }

  return {
    reply:
      "I looked into a few things but couldn't quite finish — could you ask that more specifically, or check My Reports directly?",
    toolsUsed,
    toolResults,
  };
}
