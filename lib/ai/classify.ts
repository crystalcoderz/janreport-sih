import { GoogleGenAI, Type } from "@google/genai";
import { ISSUE_CATEGORIES, type IssueCategory } from "@/lib/departments";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// "-latest" alias tracks the current Flash model, so this doesn't rot the
// way a pinned version does (gemini-2.5-flash is already 404 for new API
// keys). Still overridable per-environment.
const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";

export interface ClassificationResult {
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
  required: ["category", "severity", "confidence", "title", "description"],
};

function severityLabel(score: number): string {
  if (score >= 9) return "Critical";
  if (score >= 7) return "High";
  if (score >= 5) return "Moderate";
  if (score >= 3) return "Low";
  return "Minimal";
}

export async function classifyIssuePhoto(params: {
  imageBase64: string;
  mimeType: string;
  note?: string;
}): Promise<ClassificationResult> {
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [
      {
        inlineData: {
          mimeType: params.mimeType,
          data: params.imageBase64,
        },
      },
      {
        text: `You are triaging a citizen-submitted civic issue report for a municipal government system (JanReport). Classify the photo above into exactly one category, and score its severity/urgency for municipal response.${
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
    category: IssueCategory;
    severity: number;
    confidence: number;
    title: string;
    description: string;
  };

  const severity = Math.min(10, Math.max(1, Math.round(input.severity)));

  return {
    category: input.category,
    severity,
    severityLabel: severityLabel(severity),
    confidence: Math.min(1, Math.max(0, input.confidence)),
    title: input.title,
    description: input.description,
  };
}
