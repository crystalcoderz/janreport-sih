import { GoogleGenAI } from "@google/genai";

// One Gemini client for every AI feature (classification, duplicate photo
// comparison, voice-note transcription), because there are two different
// ways to reach the same models and the choice has to be made in one place:
//
// - The Gemini API with an AI Studio key. Trivial to set up, but its free
//   tier allows only a handful of requests per minute — a single WhatsApp
//   report spends three or four — and Google excludes it from the $300
//   Google Cloud trial credit.
// - Vertex AI, now branded Gemini Enterprise Agent Platform. This is
//   ordinary Google Cloud usage, so trial credits pay for it and the quota
//   is the project's rather than the free tier's.
//
// Vertex is used whenever it is fully configured; otherwise this falls back
// to the API key, so a deployment that hasn't finished the Cloud setup (or
// a local checkout that only has GEMINI_API_KEY) keeps working rather than
// failing at import time.

// The "-latest" alias tracks the current Flash model, so this does not rot
// the way a pinned version does (gemini-2.5-flash is already 404 for new
// API keys). Vertex exposes a different set of model ids than the Gemini
// API, so this may need overriding per-environment.
export const AI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";

let client: GoogleGenAI | null = null;

function buildClient(): GoogleGenAI {
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;

  if (project && serviceAccountJson) {
    try {
      return new GoogleGenAI({
        // `enterprise` is the SDK's preferred spelling of the older
        // `vertexai` flag; both select the same backend.
        enterprise: true,
        project,
        location: process.env.GOOGLE_CLOUD_LOCATION || "global",
        // Vercel has no writable credentials file for Application Default
        // Credentials to find, so the service account is passed inline.
        googleAuthOptions: { credentials: JSON.parse(serviceAccountJson) },
      });
    } catch (err) {
      // A malformed service account JSON must not take down every AI
      // feature — fall back to the API key and make the reason obvious.
      console.error(
        "Invalid GOOGLE_SERVICE_ACCOUNT_JSON — falling back to the Gemini API key",
        err
      );
    }
  }

  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

export function getAiClient(): GoogleGenAI {
  if (!client) client = buildClient();
  return client;
}

// Which backend the current environment resolves to. Only for logging and
// diagnostics — callers never branch on this.
export function isVertexConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLOUD_PROJECT && process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  );
}
