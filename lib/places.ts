export interface NearbyOffice {
  name: string;
  address: string;
}

// Looks up the nearest municipal/local government office for the
// acknowledgement letter. Best-effort: Places API is a separate product
// from Geocoding/Maps JS and may not be enabled on every project (it
// wasn't when this was built) — a lookup failure or empty result just
// means the letter falls back to generic wording instead of blocking the
// whole acknowledgement flow. Starts finding real offices automatically
// the moment the API is enabled, no code change needed.
export async function findNearbyMunicipalOffice(
  lat: number,
  lng: number
): Promise<NearbyOffice | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.displayName,places.formattedAddress",
      },
      body: JSON.stringify({
        includedTypes: ["local_government_office"],
        maxResultCount: 1,
        locationRestriction: {
          circle: { center: { latitude: lat, longitude: lng }, radius: 15000 },
        },
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const place = data.places?.[0];
    if (!place?.displayName?.text || !place?.formattedAddress) return null;

    return { name: place.displayName.text, address: place.formattedAddress };
  } catch {
    return null;
  }
}
