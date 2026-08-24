"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

// Minimal ambient shape for the (non-standard, vendor-prefixed) Web Speech
// API — no official TS lib includes this yet.
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const noopSubscribe = () => () => {};

export function useSpeechToText(options?: { onEnd?: (transcript: string) => void }) {
  // Recognition does not only end when the citizen presses Stop: Chrome ends
  // it by itself after a stretch of silence, even with continuous = true. The
  // caller has to be told either way, or dictation that ended on its own is
  // sitting in `transcript` when the next press clears it.
  const onEndRef = useRef(options?.onEnd);
  // Synced in an effect rather than during render: a ref written while
  // rendering is a React anti-pattern, and this only has to be current by the
  // time recognition ends.
  useEffect(() => {
    onEndRef.current = options?.onEnd;
  });
  // setState is async and `onend` fires outside React's batching, so the
  // handler reads the transcript from a ref rather than stale state.
  const transcriptRef = useRef("");
  // useSyncExternalStore (not useState+useEffect) so the browser-only
  // feature check never causes a hydration mismatch: SSR always reports
  // unsupported, and the client snapshot is read synchronously on mount.
  const supported = useSyncExternalStore(
    noopSubscribe,
    () => getSpeechRecognitionCtor() !== null,
    () => false
  );
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const start = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-IN";

    recognition.onresult = (event) => {
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript;
      }
      if (finalText) {
        setTranscript((prev) => {
          const next = prev ? `${prev} ${finalText}`.trim() : finalText;
          transcriptRef.current = next;
          return next;
        });
      }
    };
    // Both paths hand the transcript back and clear it, so the caller can
    // treat "recognition ended" as one event regardless of who ended it.
    const finish = () => {
      setListening(false);
      const text = transcriptRef.current;
      transcriptRef.current = "";
      setTranscript("");
      if (text) onEndRef.current?.(text);
    };
    recognition.onerror = finish;
    recognition.onend = finish;

    recognitionRef.current = recognition;
    transcriptRef.current = "";
    setTranscript("");
    recognition.start();
    setListening(true);
  }, []);

  // stop() only asks the engine to stop; `onend` is what actually fires, and
  // that is where the transcript is handed over.
  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const reset = useCallback(() => {
    transcriptRef.current = "";
    setTranscript("");
  }, []);

  return { supported, listening, transcript, start, stop, reset };
}
