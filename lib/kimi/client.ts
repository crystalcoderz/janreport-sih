// Thin wrapper around Moonshot AI's Kimi models via their OpenAI-compatible
// endpoint. Server-only — never import from client components.
import OpenAI from "openai";

const apiKey = process.env.KIMI_API_KEY;
const baseURL = process.env.KIMI_API_BASE_URL || "https://api.moonshot.ai/v1";

// Overridable without a redeploy in case this id goes stale. Verified
// live against this key/endpoint — kimi-k2-0711-preview 404s ("not found
// or permission denied"), kimi-k3 works and supports tool calling.
export const KIMI_MODEL = process.env.KIMI_MODEL || "kimi-k3";

export function isKimiConfigured(): boolean {
  return Boolean(apiKey);
}

// Exposed for lib/kimi/agent.ts, which needs the raw client to drive its
// own tool-calling loop. kimiChat() below stays the simple text-only path
// for the one-shot features (briefing, note drafting).
export const kimi = apiKey ? new OpenAI({ apiKey, baseURL }) : null;

export interface KimiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function kimiChat(
  messages: KimiMessage[],
  options?: { temperature?: number; maxTokens?: number }
): Promise<string> {
  if (!kimi) {
    throw new Error("Kimi is not configured (missing KIMI_API_KEY)");
  }

  const completion = await kimi.chat.completions.create({
    model: KIMI_MODEL,
    messages,
    // kimi-k3 rejects any temperature other than the default (1).
    temperature: options?.temperature ?? 1,
    max_tokens: options?.maxTokens ?? 800,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error("Kimi did not return a response");
  }
  return content;
}
