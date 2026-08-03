import Anthropic from "@anthropic-ai/sdk";
import { ISSUE_CATEGORIES, type IssueCategory } from "@/lib/departments";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface ClassificationResult {
  category: IssueCategory;
  severity: number; // 1-10
  severityLabel: string;
  confidence: number; // 0-1
  title: string;
  description: string;
}

const CLASSIFY_TOOL: Anthropic.Tool = {
  name: "submit_classification",
  description:
    "Submit the structured classification for a reported civic issue photo.",
  input_schema: {
    type: "object",
    properties: {
      category: {
        type: "string",
        enum: [...ISSUE_CATEGORIES],
        description: "The single best-matching civic issue category.",
      },
      severity: {
        type: "integer",
        minimum: 1,
        maximum: 10,
        description:
          "Severity/urgency score. 1-2 minimal, 3-4 low, 5-6 moderate, 7-8 high, 9-10 critical (danger to life/safety, major service outage).",
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description: "Model's confidence in this classification.",
      },
      title: {
        type: "string",
        description: "A short (<=8 word) human-readable issue title.",
      },
      description: {
        type: "string",
        description:
          "A 1-2 sentence objective description of what is visible in the photo, for the municipal officer.",
      },
    },
    required: ["category", "severity", "confidence", "title", "description"],
  },
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
  const message = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 512,
    tools: [CLASSIFY_TOOL],
    tool_choice: { type: "tool", name: "submit_classification" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: params.mimeType as
                | "image/jpeg"
                | "image/png"
                | "image/webp"
                | "image/gif",
              data: params.imageBase64,
            },
          },
          {
            type: "text",
            text: `You are triaging a citizen-submitted civic issue report for a municipal government system (JanReport). Classify the photo above into exactly one category, and score its severity/urgency for municipal response.${
              params.note ? `\n\nCitizen's note: "${params.note}"` : ""
            }\n\nCall submit_classification with your assessment.`,
          },
        ],
      },
    ],
  });

  const toolUse = message.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );

  if (!toolUse) {
    throw new Error("AI classification did not return a structured result");
  }

  const input = toolUse.input as {
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
