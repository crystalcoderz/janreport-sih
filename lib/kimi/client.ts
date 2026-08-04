// Thin wrapper around Moonshot AI's Kimi models via their OpenAI-compatible
// endpoint. Server-only — never import from client components.
import OpenAI from "openai";

const apiKey = process.env.KIMI_API_KEY;
const baseURL = process.env.KIMI_API_BASE_URL || "https://api.moonshot.ai/v1";

// Overridable without a redeploy in case this id goes stale.
const MODEL = process.env.KIMI_MODEL || "kimi-k2-0711-preview";

export function isKimiConfigured(): boolean {
  return Boolean(apiKey);
}

const kimi = apiKey ? new OpenAI({ apiKey, baseURL }) : null;

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
    model: MODEL,
    messages,
    temperature: options?.temperature ?? 0.6,
    max_tokens: options?.maxTokens ?? 800,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error("Kimi did not return a response");
  }
  return content;
}
