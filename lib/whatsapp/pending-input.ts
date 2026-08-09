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

export function looksLikeBareName(text: string): boolean {
  const trimmed = text.trim();
  if (!isBareAnswer(trimmed) || !NAME_SHAPE_RE.test(trimmed)) return false;
  return !trimmed
    .toLowerCase()
    .split(/\s+/)
    .some((word) => PLACE_WORDS.has(word.replace(/[.'-]/g, "")));
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
  if (!isBareAnswer(text)) return null;
  if (params.hasLocation && params.hasName) return null;

  // Name is checked first, and geocoding is not used to decide between the
  // two, because a personal name frequently IS a precise geocoder hit:
  // "deepak" returns "Deepak, Anushakti Nagar, Mumbai" — an establishment,
  // indistinguishable by specificity from a real place the citizen meant.
  // What actually separates them is the wording itself: a location the
  // citizen types carries a place word ("iilm university", "sector 62",
  // "near city hospital") or a digit, and a name doesn't.
  if (!params.hasName && looksLikeBareName(text)) {
    return { kind: "name", name: text };
  }

  if (!params.hasLocation) {
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
