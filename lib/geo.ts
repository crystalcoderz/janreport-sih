// Reverse-geocodes via OSM Nominatim (free, no API key). Best-effort —
// failures return null so the report flow never blocks on this.
async function reverseGeocodeNominatim(
  lat: number,
  lng: number
): Promise<string | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18`,
      { headers: { "Accept-Language": "en" } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.display_name ?? null;
  } catch {
    return null;
  }
}

// Reverse-geocodes via Google's Geocoding API — more reliable addresses
// than Nominatim, used when GOOGLE_MAPS_API_KEY is configured.
async function reverseGeocodeGoogle(
  lat: number,
  lng: number,
  apiKey: string
): Promise<string | null> {
  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.results?.[0]?.formatted_address ?? null;
  } catch {
    return null;
  }
}

// Reverse-geocodes coordinates to a human-readable address. Uses Google's
// Geocoding API when GOOGLE_MAPS_API_KEY is set, otherwise falls back to
// the free Nominatim endpoint above. Best-effort either way — failures
// return null so the report flow never blocks on this.
export async function reverseGeocode(
  lat: number,
  lng: number
): Promise<string | null> {
  const googleApiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (googleApiKey) {
    const address = await reverseGeocodeGoogle(lat, lng, googleApiKey);
    if (address) return address;
  }
  return reverseGeocodeNominatim(lat, lng);
}

// How precisely the geocoder actually pinned the text it was given.
// Because the search is country-biased to India, an unrecognizable query
// doesn't fail — it silently collapses to the country centroid
// ("narendra modi residence" and "ritvik" both return exactly "India").
// Callers deciding whether a citizen's message really was a location need
// to tell that apart from a genuine hit, which a null/non-null result
// alone can't express.
export type GeocodeSpecificity = "precise" | "locality" | "coarse";

export interface GeocodedLocation {
  lat: number;
  lng: number;
  formattedAddress: string;
  specificity: GeocodeSpecificity;
}

function googleSpecificity(types: string[]): GeocodeSpecificity {
  if (types.includes("country")) return "coarse";
  if (
    types.includes("locality") ||
    types.some((t) => t.startsWith("administrative_area_level_"))
  ) {
    return "locality";
  }
  return "precise";
}

async function forwardGeocodeGoogle(
  address: string,
  apiKey: string
): Promise<GeocodedLocation | null> {
  try {
    // Region-biased to India: citizens type bare local place names
    // ("gla noida", "sector 62") that are ambiguous or unfindable
    // globally but resolve fine when the search is anchored to the
    // country the service operates in.
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&region=in&components=country:IN&key=${apiKey}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const result = data.results?.[0];
    if (!result) return null;
    return {
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
      formattedAddress: result.formatted_address,
      specificity: googleSpecificity(result.types ?? []),
    };
  } catch {
    return null;
  }
}

const NOMINATIM_COARSE = new Set(["country", "state"]);
const NOMINATIM_LOCALITY = new Set([
  "city",
  "town",
  "village",
  "county",
  "state_district",
  "district",
]);

function nominatimSpecificity(addressType: string | undefined): GeocodeSpecificity {
  if (!addressType) return "precise";
  if (NOMINATIM_COARSE.has(addressType)) return "coarse";
  if (NOMINATIM_LOCALITY.has(addressType)) return "locality";
  return "precise";
}

async function forwardGeocodeNominatim(address: string): Promise<GeocodedLocation | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=in&q=${encodeURIComponent(address)}`,
      { headers: { "Accept-Language": "en", "User-Agent": "JanReport/1.0" } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const result = data[0];
    if (!result) return null;
    return {
      lat: parseFloat(result.lat),
      lng: parseFloat(result.lon),
      formattedAddress: result.display_name,
      specificity: nominatimSpecificity(result.addresstype),
    };
  } catch {
    return null;
  }
}

// Resolves a free-text address/landmark description to coordinates — the
// inverse of reverseGeocode above, used when a citizen isn't physically at
// the issue (reporting from an old photo, GPS unavailable) and describes
// the location in words instead of sharing it. Same
// Google-when-configured-else-Nominatim fallback as reverseGeocode.
export async function forwardGeocode(address: string): Promise<GeocodedLocation | null> {
  const googleApiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (googleApiKey) {
    const result = await forwardGeocodeGoogle(address, googleApiKey);
    if (result) return result;
  }
  return forwardGeocodeNominatim(address);
}

export function googleMapsLink(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

const EARTH_RADIUS_M = 6371000;

export function haversineDistanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}
