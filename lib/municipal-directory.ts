import type { createServiceRoleClient } from "@/lib/supabase/server";

// Resolves which municipal body a report should actually be sent to, from the
// report's own coordinates.
//
// Why a directory table rather than a lookup at send time: there is no API that
// returns a municipal body's email. Google Places gives a name and a postal
// address and nothing else, and an address cannot be derived from a name — a
// pattern-built guess like info@<city>nagarnigam.gov.in either bounces or, far
// worse, reaches a stranger while the citizen is told their complaint was
// filed. So every address here is one a human can trace: the row carries the
// page it was read from and the surrounding text it was quoted with.
//
// Nothing is sent to an unverified row. `verified` is the switch that says a
// person has checked the provenance, and the resolver ignores everything else,
// so a half-researched entry is inert rather than dangerous.

export interface MunicipalOffice {
  id: string;
  name: string;
  jurisdiction: string;
  contactEmail: string;
  sourceUrl: string;
  grievancePortalUrl: string | null;
  notes: string | null;
  lat: number;
  lng: number;
  radiusKm: number;
  /** Distance from the report to this office, filled in by the resolver. */
  distanceKm: number;
}

interface OfficeRow {
  id: string;
  name: string;
  jurisdiction: string;
  contact_email: string;
  source_url: string;
  grievance_portal_url: string | null;
  notes: string | null;
  lat: number;
  lng: number;
  radius_km: number;
}

const EARTH_RADIUS_KM = 6371;

export function haversineKm(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * The nearest verified municipal office whose jurisdiction plausibly covers
 * this point, or null if none does.
 *
 * Distance is computed here rather than in SQL because the directory is a few
 * dozen rows at most; a PostGIS query would be more machinery than the problem
 * needs, and this keeps the radius rule visible in one place.
 */
export async function findMunicipalOfficeFor(
  supabase: ReturnType<typeof createServiceRoleClient>,
  lat: number,
  lng: number
): Promise<MunicipalOffice | null> {
  const { data, error } = await supabase
    .from("municipal_offices")
    .select(
      "id, name, jurisdiction, contact_email, source_url, grievance_portal_url, notes, lat, lng, radius_km"
    )
    .eq("verified", true);

  if (error) {
    console.error("[municipal-directory] lookup failed", error);
    return null;
  }

  let best: MunicipalOffice | null = null;
  for (const row of (data ?? []) as OfficeRow[]) {
    const distanceKm = haversineKm(lat, lng, row.lat, row.lng);
    // Each office declares how far it plausibly reaches. A report outside every
    // radius gets no office rather than the least-distant wrong one: sending a
    // Lucknow pothole to Delhi helps nobody.
    if (distanceKm > row.radius_km) continue;
    if (best && best.distanceKm <= distanceKm) continue;
    best = {
      id: row.id,
      name: row.name,
      jurisdiction: row.jurisdiction,
      contactEmail: row.contact_email,
      sourceUrl: row.source_url,
      grievancePortalUrl: row.grievance_portal_url,
      notes: row.notes,
      lat: row.lat,
      lng: row.lng,
      radiusKm: row.radius_km,
      distanceKm,
    };
  }
  return best;
}

/** Every verified office address, for the inbound reply allowlist. */
export async function verifiedOfficeEmails(
  supabase: ReturnType<typeof createServiceRoleClient>
): Promise<string[]> {
  const { data, error } = await supabase
    .from("municipal_offices")
    .select("contact_email")
    .eq("verified", true);

  if (error) {
    console.error("[municipal-directory] allowlist lookup failed", error);
    return [];
  }
  return ((data ?? []) as { contact_email: string }[]).map((r) => r.contact_email);
}
