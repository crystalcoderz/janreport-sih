import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";

// Candidate photos come from our own storage (Supabase/R2 public URLs), but
// they are still fetched over the network, so cap what we are willing to
// pull into memory and hand to the model.
const MAX_CANDIDATE_BYTES = 8 * 1024 * 1024;

// Below this, a "same issue" answer is treated as a guess rather than a
// match. Surfacing a wrong duplicate makes the citizen argue with the bot
// about a photo of somewhere else entirely, which is worse than
// occasionally filing two reports an officer can merge later.
const MIN_CONFIDENCE = 0.6;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    sameIssue: {
      type: Type.BOOLEAN,
      description:
        "True only if both photos show the same individual real-world problem at the same spot.",
    },
    confidence: {
      type: Type.NUMBER,
      minimum: 0,
      maximum: 1,
      description: "Confidence in the sameIssue verdict.",
    },
    reason: {
      type: Type.STRING,
      description: "One short sentence explaining the verdict, for server logs.",
    },
  },
  required: ["sameIssue", "confidence", "reason"],
};

const PROMPT = `Two photos were submitted to a municipal civic-issue reporting system. They were taken within 75 metres of each other and were auto-classified into the same category, so they are candidates for being duplicate reports of one problem.

Photo A is the new report. Photo B is an existing open report.

Decide whether they show THE SAME individual real-world problem — the same pothole, the same pile of garbage, the same broken pole — judging by the physical scene: surroundings, buildings, road markings, signage, vegetation, the shape and position of the damage itself.

Answer false when:
- They show two different instances of the same kind of problem (two separate potholes on the same street are NOT the same issue).
- Either photo shows no clear civic issue at all (a plain floor, a wall, an indoor scene, a blurry or unrelated image).
- The surroundings clearly do not match.
- You cannot tell.

Only answer true when the visual evidence genuinely indicates one and the same problem.`;

export interface PhotoComparison {
  sameIssue: boolean;
  confidence: number;
  reason: string;
}

async function fetchAsInlineData(
  url: string
): Promise<{ data: string; mimeType: string } | null> {
  const res = await fetch(url);
  if (!res.ok) return null;

  const mimeType = res.headers.get("content-type") ?? "image/jpeg";
  if (!mimeType.startsWith("image/")) return null;

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.byteLength > MAX_CANDIDATE_BYTES) return null;

  return { data: buffer.toString("base64"), mimeType };
}

// Returns null when the comparison could not be made at all (candidate
// photo missing, unreadable, or the model call failed). Callers decide what
// an unknown means — dedupe treats it as "still a candidate", so a flaky
// call can never cause a real duplicate to be filed silently.
export async function comparePhotosForDuplicate(params: {
  newImageBase64: string;
  newMimeType: string;
  candidateImageUrl: string;
}): Promise<PhotoComparison | null> {
  let candidate;
  try {
    candidate = await fetchAsInlineData(params.candidateImageUrl);
  } catch (err) {
    console.error("Duplicate photo fetch failed", err);
    return null;
  }
  if (!candidate) return null;

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [
        { text: "Photo A (new report):" },
        { inlineData: { mimeType: params.newMimeType, data: params.newImageBase64 } },
        { text: "Photo B (existing open report):" },
        { inlineData: { mimeType: candidate.mimeType, data: candidate.data } },
        { text: PROMPT },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    });

    const text = response.text;
    if (!text) return null;

    const parsed = JSON.parse(text) as PhotoComparison;
    return {
      sameIssue: Boolean(parsed.sameIssue),
      confidence: Math.min(1, Math.max(0, parsed.confidence)),
      reason: parsed.reason,
    };
  } catch (err) {
    console.error("Duplicate photo comparison failed", err);
    return null;
  }
}

export function isConfirmedDuplicate(comparison: PhotoComparison | null): boolean {
  // Unknown (null) stays a candidate — see comparePhotosForDuplicate.
  if (!comparison) return true;
  return comparison.sameIssue && comparison.confidence >= MIN_CONFIDENCE;
}
