import { Type } from "@google/genai";
import { getAiClient, AI_MODEL } from "@/lib/ai/client";
import { ISSUE_CATEGORIES, type IssueCategory } from "@/lib/departments";
import { withAiRetry } from "@/lib/ai/retry";

export interface ClassificationResult {
  // False when the photo shows no civic issue at all — a selfie, an indoor
  // floor, a blurry wall. Asked of the model directly rather than inferred
  // from category/severity, because those do not separate it: real junk comes
  // back as `other` at confidence 0.95-1.00, and `other` is also a legitimate
  // category for a genuine issue that fits nothing else.
  isCivicIssue: boolean;
  category: IssueCategory;
  severity: number; // 1-10
  severityLabel: string;
  confidence: number; // 0-1
  title: string;
  description: string;
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    isCivicIssue: {
      type: Type.BOOLEAN,
      description:
        "True only if the photo actually shows a civic/municipal problem in a public place. False for selfies, people, pets, food, screenshots, indoor rooms, plain floors or walls, blurry or unidentifiable images, and anything with no visible problem.",
    },
    category: {
      type: Type.STRING,
      format: "enum",
      enum: [...ISSUE_CATEGORIES],
      description: "The single best-matching civic issue category.",
    },
    severity: {
      type: Type.INTEGER,
      minimum: 1,
      maximum: 10,
      description:
        "Severity/urgency score. 1-2 minimal, 3-4 low, 5-6 moderate, 7-8 high, 9-10 critical (danger to life/safety, major service outage).",
    },
    confidence: {
      type: Type.NUMBER,
      minimum: 0,
      maximum: 1,
      description: "Model's confidence in this classification.",
    },
    title: {
      type: Type.STRING,
      description: "A short (<=8 word) human-readable issue title.",
    },
    description: {
      type: Type.STRING,
      description:
        "A 1-2 sentence objective description of what is visible in the photo, for the municipal officer.",
    },
  },
  required: ["isCivicIssue", "category", "severity", "confidence", "title", "description"],
};

function severityLabel(score: number): string {
  if (score >= 9) return "Critical";
  if (score >= 7) return "High";
  if (score >= 5) return "Moderate";
  if (score >= 3) return "Low";
  return "Minimal";
}

// By the time this runs on WhatsApp the citizen has already sent a photo, a
// location and their name, and a single transient failure discards all of
// it and asks them to start over with a photo the server is in fact still
// holding.
export async function classifyIssuePhoto(params: {
  imageBase64: string;
  mimeType: string;
  note?: string;
}): Promise<ClassificationResult> {
  return withAiRetry("AI classification", () => classifyOnce(params));
}

async function classifyOnce(params: {
  imageBase64: string;
  mimeType: string;
  note?: string;
}): Promise<ClassificationResult> {
  const response = await getAiClient().models.generateContent({
    model: AI_MODEL,
    contents: [
      {
        inlineData: {
          mimeType: params.mimeType,
          data: params.imageBase64,
        },
      },
      {
        text: `You are triaging a citizen-submitted civic issue report for a municipal government system (JanReport). First decide whether the photo shows a real civic issue at all — citizens frequently send selfies, pets, food, screenshots or photos of an indoor floor by mistake. If it does not show a municipal problem in a public place, set isCivicIssue to false. Then classify the photo into exactly one category, and score its severity/urgency for municipal response.${
          params.note ? `\n\nCitizen's note: "${params.note}"` : ""
        }\n\nRespond with the classification as JSON matching the provided schema.`,
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error("AI classification did not return a structured result");
  }

  const input = JSON.parse(text) as {
    isCivicIssue: boolean;
    category: IssueCategory;
    severity: number;
    confidence: number;
    title: string;
    description: string;
  };

  const severity = Math.min(10, Math.max(1, Math.round(input.severity)));

  return {
    isCivicIssue: input.isCivicIssue !== false,
    category: input.category,
    severity,
    severityLabel: severityLabel(severity),
    confidence: Math.min(1, Math.max(0, input.confidence)),
    title: input.title,
    description: input.description,
  };
}
