import { forwardGeocode, type GeocodedLocation } from "@/lib/geo";

// When a citizen is mid-report, the bot asks for a location and a name,
// and they answer one at a time with a bare fragment — "iilm university",
// "ritvik". Neither carries an anchor phrase, so name-detection.ts can't
// see it and the agent is left to notice and call the right tool. Under
// the thinking-disabled speed setting it reliably doesn't: in production
// it replied "Got it — I'll set the location to IILM University" and
// "Name: Ritvik" while saving neither, then five minutes later claimed it
// had no location at all. This resolves those two answers deterministically
// instead, the same way link and anchored-name detection already are.

// Words that give away a place rather than a person, so "iilm university"
// is never mistaken for someone's name.
const PLACE_WORDS = new Set([
  "road", "rd", "street", "st", "lane", "marg", "chowk", "circle", "cross",
  "sector", "block", "phase", "plot", "gali", "nagar", "puram", "pura",
  "colony", "vihar", "enclave", "extension", "park", "garden", "society",
  "university", "college", "school", "institute", "campus", "hospital",
  "clinic", "market", "mandi", "bazaar", "mall", "station", "depot",
  "stand", "stop", "terminal", "airport", "bridge", "flyover", "crossing",
  "temple", "mandir", "masjid", "church", "gurudwara", "office", "bhawan",
  "tower", "complex", "apartment", "apartments", "residency", "residence",
  "village", "town", "city", "district", "tehsil", "near", "opposite",
  "behind", "beside", "front",
  // Hinglish, which is how citizens actually write a location: "ghar ke
  // pas" (near the house), "station ke samne" (opposite the station).
  // Without these, "Prayas ke ghar ke pas, Uttar Pradesh, Delhi" carried no
  // recognised place word at all and was dropped on the floor.
  "ghar", "makan", "makaan", "pas", "paas", "nazdeek", "samne", "saamne",
  "peeche", "piche", "mohalla", "basti", "ilaka", "chauraha", "gaon",
  "kasba", "naka", "tiraha", "modh", "mod",
]);

// The other thing a citizen types mid-report that is short, unpunctuated
// and name-shaped: the issue itself. Without this, "big pothole here" and
// "garbage" get filed as who they are, and the acknowledgement letter goes
// out addressed "Dear big pothole here,".
const ISSUE_WORDS = new Set([
  "pothole", "potholes", "hole", "holes", "garbage", "trash", "waste",
  "rubbish", "dump", "dumping", "kachra", "water", "sewage", "sewer",
  "drain", "drainage", "nali", "leak", "leaking", "leakage", "light",
  "lights", "streetlight", "lamp", "power", "electricity", "current",
  "bijli", "wire", "wires", "cable", "pole", "transformer", "tree",
  "branch", "dog", "dogs", "stray", "cattle", "toilet", "manhole",
  "footpath", "pavement", "signal", "sign", "bin", "dustbin", "smell",
  "smoke", "fire", "traffic", "parking", "encroachment",
  // condition and urgency words that pad those out into a phrase
  "broken", "damaged", "blocked", "clogged", "overflow", "overflowing",
  "cracked", "missing", "dirty", "filthy", "stinking", "smelly", "open",
  "fallen", "burnt", "dead", "dangerous", "unsafe", "urgent", "emergency",
  "big", "large", "small", "deep", "huge", "many", "lot", "lots", "very",
  "not", "working", "since", "days", "weeks", "months", "everyday",
  "daily", "again", "still",
  // generic filler
  "here", "there", "everywhere", "issue", "issues", "problem", "problems",
  "complaint", "report", "repair", "fix", "please", "help", "area",
  "place", "side", "kindly", "sir", "madam",
]);

const NAME_SHAPE_RE = /^[a-zA-Zऀ-ॿ][a-zA-Zऀ-ॿ.'-]*(?:\s+[a-zA-Zऀ-ॿ][a-zA-Zऀ-ॿ.'-]*){0,3}$/;

// Openers that mark a message as a question or command rather than an
// answer to "where is it?" / "what's your name?". Without this, "my
// reports" is short enough and name-shaped enough to be filed away as the
// citizen's name.
const NOT_AN_ANSWER_RE =
  /^(what|where|when|why|how|who|which|can|could|would|should|is|are|am|do|does|did|please|show|list|give|send|tell|status|cancel|stop|start|help|hi+|hello+|hey+|namaste|thanks|thank|ok|okay|yes|no|my|the|this|that|it)\b/i;

// A bare answer, not a sentence — anything longer is the citizen talking,
// and belongs to the agent rather than to a regex.
function isBareAnswer(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2 || trimmed.length > 60) return false;
  if (trimmed.split(/\s+/).length > 6) return false;
  if (trimmed.includes("?") || NOT_AN_ANSWER_RE.test(trimmed)) return false;
  return true;
}

// A longer message that is still an answer to "where is it?" — it names a
// place ("ghar ke pas", "sector 62", "near city hospital") and is short
// enough to be an answer rather than a story. Deliberately capped: past this
// the citizen is describing the problem, and that belongs to the agent.
const LOCATION_PHRASE_MAX_WORDS = 14;
const LOCATION_PHRASE_MAX_CHARS = 120;

export function looksLikeLocationPhrase(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2 || trimmed.length > LOCATION_PHRASE_MAX_CHARS) return false;
  const words = trimmed.split(/\s+/);
  if (words.length > LOCATION_PHRASE_MAX_WORDS) return false;
  if (trimmed.includes("?") || NOT_AN_ANSWER_RE.test(trimmed)) return false;
  // Must actually name a place, or carry a number (a sector/plot/house).
  const normalized = words.map((w) => w.toLowerCase().replace(/[^a-z0-9ऀ-ॿ]/g, ""));
  if (normalized.some((w) => ISSUE_WORDS.has(w))) return false;
  return normalized.some((w) => PLACE_WORDS.has(w)) || /\d/.test(trimmed);
}

// True when the message names a civic problem rather than a place.
//
// The geocoder is country-biased and answers almost anything: "big pothole"
// and "garbage" both return a confident hit somewhere in India. A bare answer
// skips the looksLikeLocationPhrase gate above, so without this a citizen
// describing the problem had that description silently pinned as the report's
// location -- and the photo then belonged to a spot they never named.
export function containsIssueWord(text: string): boolean {
  return text
    .trim()
    .split(/\s+/)
    .map((w) => w.toLowerCase().replace(/[^a-z0-9ऀ-ॿ]/g, ""))
    .some((w) => ISSUE_WORDS.has(w));
}

export function looksLikeBareName(text: string): boolean {
  const trimmed = text.trim();
  if (!isBareAnswer(trimmed) || !NAME_SHAPE_RE.test(trimmed)) return false;
  return !trimmed
    .toLowerCase()
    .split(/\s+/)
    .some((raw) => {
      const word = raw.replace(/[.'-]/g, "");
      return PLACE_WORDS.has(word) || ISSUE_WORDS.has(word);
    });
}

export type PendingInputResolution =
  | { kind: "location"; location: GeocodedLocation }
  | { kind: "name"; name: string };

export async function resolvePendingReportInput(params: {
  text: string;
  hasLocation: boolean;
  hasName: boolean;
}): Promise<PendingInputResolution | null> {
  const text = params.text.trim();
  if (params.hasLocation && params.hasName) return null;

  // A name is always a short fragment, so the bare-answer shape still gates
  // it. A location is not: "Prayas ke ghar ke pas, Uttar Pradesh, Delhi" is
  // seven words and was rejected outright by the six-word cap, so nothing was
  // saved and the agent invented "Location mil gayi". A longer message still
  // counts as a location attempt when it carries a place word, which is the
  // same signal used to tell a place from a person below.
  const bare = isBareAnswer(text);
  if (!bare && !(looksLikeLocationPhrase(text) && !params.hasLocation)) {
    return null;
  }

  // Name is checked first, and geocoding is not used to decide between the
  // two, because a personal name frequently IS a precise geocoder hit:
  // "deepak" returns "Deepak, Anushakti Nagar, Mumbai" — an establishment,
  // indistinguishable by specificity from a real place the citizen meant.
  // What actually separates them is the wording itself: a location the
  // citizen types carries a place word ("iilm university", "sector 62",
  // "near city hospital") or a digit, and a name doesn't.
  if (bare && !params.hasName && looksLikeBareName(text)) {
    return { kind: "name", name: text };
  }

  // Never geocode a description of the problem. looksLikeLocationPhrase
  // already refuses these, but a short message reaches here as a `bare`
  // answer without ever passing through it.
  if (!params.hasLocation && !containsIssueWord(text)) {
    const geocoded = await forwardGeocode(text);
    // A bare "locality" is only trusted once the name is on file, since a
    // country-biased search also fuzzy-matches names onto towns ("deepak"
    // → Dipka, Chhattisgarh) — pinning a report a thousand kilometres from
    // the pothole is far worse than asking one more question.
    if (
      geocoded &&
      (geocoded.specificity === "precise" ||
        (geocoded.specificity === "locality" && params.hasName))
    ) {
      return { kind: "location", location: geocoded };
    }
  }

  return null;
}
