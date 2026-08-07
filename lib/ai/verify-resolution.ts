import { GoogleGenAI, Type } from "@google/genai";
import { CATEGORY_LABELS, type IssueCategory } from "@/lib/departments";
import { isAllowedPhotoUrl } from "@/lib/storage";
import type { ResolutionVerdict } from "@/lib/supabase/types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export interface ResolutionVerdictResult {
  verdict: ResolutionVerdict;
  confidence: number; // 0-1
  reason: string;
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    verdict: {
      type: Type.STRING,
      format: "enum",
      enum: ["verified", "not_fixed", "unclear"],
      description:
        "'verified' if the reported issue is genuinely resolved in the AFTER photo; 'not_fixed' if the issue is still clearly present; 'unclear' if the photos are of different places, too ambiguous, or you cannot reasonably tell.",
    },
    confidence: {
      type: Type.NUMBER,
      minimum: 0,
      maximum: 1,
      description: "Confidence in this verdict.",
    },
    reason: {
      type: Type.STRING,
      description:
        "One or two sentences, addressed to a citizen, explaining what changed or did not change between the two photos. Be concrete about what is visible.",
    },
  },
  required: ["verdict", "confidence", "reason"],
};

async function fetchImageAsBase64(
  url: string
): Promise<{ data: string; mimeType: string }> {
  // Belt-and-braces against SSRF: the status route already rejects photo
  // URLs off our storage hosts, but this is the function that actually
  // makes the outbound request, so it re-checks rather than trusting that
  // every present and future caller validated first.
  if (!isAllowedPhotoUrl(url)) {
    throw new Error(`Refusing to fetch image from a non-storage host: ${url}`);
  }

  const res = await fetch(url, { redirect: "error" });
  if (!res.ok) {
    throw new Error(`Failed to fetch image (${res.status}): ${url}`);
  }

  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  if (!contentType.startsWith("image/")) {
    throw new Error(`URL is not an image (${contentType}): ${url}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`Image too large to verify: ${url}`);
  }

  return { data: buffer.toString("base64"), mimeType: contentType };
}

// Compares the citizen's original report photo against the officer's
// resolution photo and judges whether the issue was actually fixed. This
// is the accountability mechanism: a "resolved" status backed by evidence
// rather than an unverifiable click.
//
// Throws on failure — callers should treat verification as best-effort and
// never block a status update on it.
export async function verifyResolution(params: {
  beforeUrl: string;
  afterUrl: string;
  issueTitle: string;
  category: string;
}): Promise<ResolutionVerdictResult> {
  const [before, after] = await Promise.all([
    fetchImageAsBase64(params.beforeUrl),
    fetchImageAsBase64(params.afterUrl),
  ]);

  const categoryLabel =
    CATEGORY_LABELS[params.category as IssueCategory] ?? params.category;

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [
      { text: "BEFORE photo — the issue as originally reported by a citizen:" },
      { inlineData: { mimeType: before.mimeType, data: before.data } },
      { text: "AFTER photo — submitted by a municipal officer as proof of resolution:" },
      { inlineData: { mimeType: after.mimeType, data: after.data } },
      {
        text: `The reported issue was: "${params.issueTitle}" (category: ${categoryLabel}).

You are auditing whether this civic issue was genuinely resolved, on behalf of the citizens who reported it. Municipal officers sometimes mark issues resolved without actually fixing them, so be appropriately skeptical — but also fair, since lighting, angle, and time of day will differ legitimately between the two photos.

Decide:
- "verified" — the specific reported problem is visibly gone in the AFTER photo.
- "not_fixed" — the problem is still clearly visible in the AFTER photo.
- "unclear" — the photos appear to show different locations, or you genuinely cannot tell.

Judge only the reported issue. Unrelated differences between the photos do not by themselves mean it was fixed.`,
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error("Resolution verification returned no structured result");
  }

  const parsed = JSON.parse(text) as ResolutionVerdictResult;
  return {
    verdict: parsed.verdict,
    confidence: Math.min(1, Math.max(0, parsed.confidence)),
    reason: parsed.reason,
  };
}
