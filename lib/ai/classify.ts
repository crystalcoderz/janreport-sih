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
  // False when the photo cannot be acted on: too blurry, too dark, too far
  // away, or too tightly cropped to show where the problem is. An officer
  // dispatched from an unusable photo wastes a trip.
  imageUsable: boolean;
  // True for a real but negligible issue — a single wrapper, a hairline
  // crack — that does not warrant dispatching a crew.
  isTrivial: boolean;
  // One short sentence for the citizen when any of the three gates fails.
  rejectionReason: string;
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
        "True only if the photo actually shows a civic/municipal problem in a public place. False for selfies, people, pets, food, memes, screenshots, indoor rooms, plain floors or walls, and anything with no visible problem. Also false for a photo OF A SCREEN showing a picture of an issue — a monitor, phone or TV displaying a stock photo or web page is not a report of a real problem; look for screen bezels, cursors, taskbars, browser chrome, moire patterns or app icons.",
    },
    imageUsable: {
      type: Type.BOOLEAN,
      description:
        "True if an officer could act on this photo. False if it is badly blurred, too dark to make out, shot from so far away the problem cannot be identified, or cropped so tightly there is no context for where it is. Judge usability, not photographic quality — an ordinary phone snapshot in daylight is usable.",
    },
    isTrivial: {
      type: Type.BOOLEAN,
      description:
        "True only for a genuine but negligible issue not worth dispatching a crew for: a single piece of litter, a hairline surface crack, a small stain. A pothole a vehicle could hit, a spilling bin, or any standing-water road defect is NOT trivial.",
    },
    rejectionReason: {
      type: Type.STRING,
      description:
        "If isCivicIssue is false, imageUsable is false, or isTrivial is true: one short sentence, addressed to the citizen, saying what is wrong with the photo and what to send instead. Otherwise an empty string.",
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
  required: ["isCivicIssue", "imageUsable", "isTrivial", "rejectionReason", "category", "severity", "confidence", "title", "description"],
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
        text: `You are triaging a citizen-submitted civic issue report for a municipal government system (JanReport). Before classifying, screen the photo on three things. (1) Does it show a real civic issue at all? Citizens frequently send selfies, pets, food, screenshots or photos of an indoor floor by mistake. (2) Could an officer actually act on it, or is it too blurry, too dark, too distant or too tightly cropped to locate the problem? (3) Is it so minor that dispatching a crew would be a waste — a single wrapper, a hairline crack? Be careful with the third: a pothole deep enough for a vehicle to hit, a bin that is spilling, or a road defect holding standing water is a genuine issue no matter how ordinary it looks, and rejecting a real report is far worse than accepting a marginal one. Then classify the photo into exactly one category, and score its severity/urgency for municipal response.${
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
    imageUsable: boolean;
    isTrivial: boolean;
    rejectionReason: string;
    category: IssueCategory;
    severity: number;
    confidence: number;
    title: string;
    description: string;
  };

  const severity = Math.min(10, Math.max(1, Math.round(input.severity)));

  return {
    isCivicIssue: input.isCivicIssue !== false,
    // Default to usable / non-trivial when the model omits the field, so a
    // malformed response never silently rejects a real report.
    imageUsable: input.imageUsable !== false,
    isTrivial: input.isTrivial === true,
    rejectionReason: input.rejectionReason ?? "",
    category: input.category,
    severity,
    severityLabel: severityLabel(severity),
    confidence: Math.min(1, Math.max(0, input.confidence)),
    title: input.title,
    description: input.description,
  };
}

// The single gate every filing path asks. Kept here, next to the fields it
// reads, so the WhatsApp bot and the web form can never drift apart on what
// counts as a reportable photo.
export function rejectionFor(c: ClassificationResult): string | null {
  if (!c.isCivicIssue) {
    return (
      c.rejectionReason ||
      "That photo doesn't show a civic issue. Send a photo of the problem itself."
    );
  }
  if (!c.imageUsable) {
    return (
      c.rejectionReason ||
      "That photo is too unclear to act on. Try again from a bit closer, in better light."
    );
  }
  if (c.isTrivial) {
    return (
      c.rejectionReason ||
      "That looks too minor to send a crew for. Report it if it gets worse."
    );
  }
  return null;
}
