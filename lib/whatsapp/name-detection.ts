// Detects an explicit name statement ("My name is X", "mera naam X hai",
// capitalized "I am X"/"I'm X") deterministically, so a citizen's name can
// be saved as a side effect before the agent even runs. This exists
// because relying on the model to notice "this message states a name" and
// call set_reporter_name proved unreliable under the thinking-disabled
// speed setting (see lib/kimi/agent.ts) — it would happily reply "Thanks,
// Rohit!" in prose without ever persisting anything, silently stalling the
// report. A regex can't be talked out of doing its job, and it's instant
// besides.
//
// Continuation words after the first must be capitalized ("Sharma"
// continues "Rohit"; "and" does not) — without this a message like "my
// name is Deepak and there's a pothole" swallows half the sentence as the
// "name". That capitalization check only works if it's genuinely
// case-sensitive, which rules out matching the whole pattern with a
// single /i flag (it would silently re-permit lowercase continuations) —
// so the case-insensitive anchor and the case-sensitive name capture are
// deliberately two separate regexes applied in sequence, not one pattern
// with a flag.
const NAME_ANCHOR_RE = /\b(?:my name is|mera naam(?: hai)?)\s*[:-]?\s*/i;
const NAME_CAPTURE_RE =
  /^([a-zA-Zऀ-ॿ][a-zA-Zऀ-ॿ.'-]*(?:\s+[A-Zऀ-ॿ][a-zA-Zऀ-ॿ.'-]*){0,3})/;

// "I am"/"I'm" uses an explicit [Ii] class rather than /i for the same
// reason — the anchor needs to be case-insensitive while the captured
// name stays case-sensitive, since requiring a real capital letter is what
// distinguishes "I am Rohit" (a name) from "i am facing an issue" (not
// one).
const CAPITALIZED_INTRO_RE =
  /\b(?:[Ii]\s?am|[Ii]'m)\s+([A-Z][a-zA-Z.'-]*(?:\s+[A-Z][a-zA-Z.'-]*){0,3})\b/;

// Words that structurally look like a name capture but aren't one:
// - After "I'm"/"I am": that phrase almost always opens a sentence, and
//   phone keyboards auto-capitalize a sentence's first word regardless of
//   what it is — "I'm Facing an issue" or "I am Sorry for the delay"
//   capitalizes exactly like a real name would ("I'm Rohit").
// - After "my name is"/"mera naam": a citizen declining to give their name
//   ("my name is not important", "mera naam nahi bataunga" — "I won't tell
//   my name") grammatically fits the same slot a real name would.
// Neither regex can tell these apart structurally, so reject the specific
// non-name words that actually show up in this slot in practice.
const NON_NAME_FIRST_WORDS = new Set([
  "facing", "having", "trying", "going", "not", "still", "also", "just",
  "currently", "dealing", "experiencing", "seeing", "noticing", "writing",
  "reporting", "sending", "sharing", "calling", "living", "staying",
  "working", "looking", "wondering", "asking", "extremely", "really",
  "very", "quite", "so", "here", "there", "back", "again", "fine", "good",
  "okay", "ok", "sorry", "glad", "happy", "sad", "upset", "worried",
  "frustrated", "angry", "tired", "done", "new", "old", "sure", "unable",
  "unsure", "afraid", "confused", "concerned", "attaching", "uploading",
  "private", "secret", "unknown", "irrelevant", "unimportant",
  // romanized Hindi
  "nahi", "nahin", "mat", "bhi", "kya", "kaun", "kyun", "kyu", "pucho",
  "batana", "bataunga", "bataungi",
]);

function firstWordIsNonName(raw: string): boolean {
  return NON_NAME_FIRST_WORDS.has(raw.split(/\s+/)[0].toLowerCase());
}

function matchAfterAnchor(text: string): string | null {
  const anchor = text.match(NAME_ANCHOR_RE);
  if (!anchor || anchor.index === undefined) return null;
  const rest = text.slice(anchor.index + anchor[0].length);
  const captured = rest.match(NAME_CAPTURE_RE);
  return captured ? captured[1] : null;
}

export function extractStatedName(text: string): string | null {
  const raw = matchAfterAnchor(text) ?? text.match(CAPITALIZED_INTRO_RE)?.[1] ?? null;
  if (!raw || firstWordIsNonName(raw)) return null;
  const name = raw.replace(/\b(hai|please)\b/gi, "").trim();
  if (name.length < 2 || name.length > 60) return null;
  return name;
}
