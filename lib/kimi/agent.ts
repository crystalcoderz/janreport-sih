import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { kimi, KIMI_MODEL, isKimiConfigured } from "@/lib/kimi/client";
import { TOOL_DEFINITIONS, executeTool, type ToolContext } from "@/lib/kimi/tools";

// Bounded call -> execute tools -> feed results -> repeat loop. Capped so
// a confused model can't loop forever or run up cost on one request.
const MAX_ITERATIONS = 4;

export interface AgentResult {
  reply: string;
  toolsUsed: string[];
}

export async function runKimiAgent(
  systemPrompt: string,
  userMessages: ChatCompletionMessageParam[],
  ctx: ToolContext
): Promise<AgentResult> {
  if (!isKimiConfigured() || !kimi) {
    throw new Error("Kimi is not configured (missing KIMI_API_KEY)");
  }

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...userMessages,
  ];
  const toolsUsed: string[] = [];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const completion = await kimi.chat.completions.create({
      model: KIMI_MODEL,
      messages,
      tools: [...TOOL_DEFINITIONS],
      temperature: 0.4,
      max_tokens: 600,
    });

    const message = completion.choices[0]?.message;
    if (!message) break;

    messages.push(message);

    if (!message.tool_calls || message.tool_calls.length === 0) {
      return { reply: message.content ?? "", toolsUsed };
    }

    for (const call of message.tool_calls) {
      // Kimi (like OpenAI) can emit non-function tool call variants in
      // principle; this app only ever declares function tools.
      if (call.type !== "function") continue;

      let args: Record<string, unknown> = {};
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        // Malformed arguments from the model — fall through with {} so
        // the tool gets a chance to report a sane error instead of the
        // whole turn crashing.
      }

      const result = await executeTool(call.function.name, args, ctx);
      toolsUsed.push(call.function.name);

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }

  return {
    reply:
      "I looked into a few things but couldn't quite finish — could you ask that more specifically, or check My Reports directly?",
    toolsUsed,
  };
}
