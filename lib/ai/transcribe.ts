import { getAiClient, AI_MODEL } from "@/lib/ai/client";

// Transcribes a WhatsApp voice note so it can be fed into the same
// userText pipeline as a typed message — report filing, status lookups,
// cancel, all of it just works because the agent never knows the
// difference between "typed" and "spoken then transcribed".
export async function transcribeAudio(params: {
  audioBase64: string;
  mimeType: string;
}): Promise<string> {
  const response = await getAiClient().models.generateContent({
    model: AI_MODEL,
    contents: [
      {
        inlineData: {
          // WhatsApp sends mime types like "audio/ogg; codecs=opus" —
          // Gemini expects a bare mime type.
          mimeType: params.mimeType.split(";")[0].trim(),
          data: params.audioBase64,
        },
      },
      {
        text: "Transcribe this voice message exactly as spoken, in its original language (Hindi, English, or a mix). Return only the transcription — no commentary, no translation.",
      },
    ],
  });

  const text = response.text?.trim();
  if (!text) {
    throw new Error("Gemini did not return a transcription");
  }
  return text;
}
