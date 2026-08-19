// Gemini returns 503 ("this model is currently experiencing high demand")
// and 429 often enough that a single-shot call is not a reasonable way to
// run anything a citizen is waiting on. Observed live: two of four vision
// calls in a row failed with 503 while the model was busy.
const DEFAULT_ATTEMPTS = 3;
const BASE_DELAY_MS = 700;

// Only server-side failures are worth retrying. A 429 in particular must
// not be: the free tier answers "retry in 42s", which is far longer than a
// citizen will wait in a chat, and hammering it just spends the quota the
// wait is for. Same for 400/403 — those are never going to succeed on a
// second identical call.
function isRetryable(err: unknown): boolean {
  const status = (err as { status?: unknown })?.status;
  if (typeof status === "number") return status >= 500;
  return true; // network/parse failures have no status and are worth a retry
}

export async function withAiRetry<T>(
  label: string,
  fn: () => Promise<T>,
  attempts: number = DEFAULT_ATTEMPTS
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isRetryable(err)) {
        console.warn(`${label}: not retryable, giving up`, err);
        throw err;
      }
      if (attempt < attempts) {
        console.warn(`${label}: attempt ${attempt} failed, retrying`, err);
        // Linear backoff — these outages clear in seconds, and the citizen
        // is sitting in a WhatsApp chat waiting for the reply, so there is
        // no room for a long exponential tail.
        // Full jitter. Without it, several requests that fail on the same
        // upstream blip retry in lockstep and hit it together again.
        const backoff = BASE_DELAY_MS * attempt * (0.5 + Math.random());
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
  }
  throw lastError;
}
