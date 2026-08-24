import { describe, it, expect } from "vitest";
import { findMunicipalOfficeFor, haversineKm } from "@/lib/municipal-directory";

// Real coordinates, so the distances in these tests mean something.
const GREATER_NOIDA = { lat: 28.4744, lng: 77.504 };
const GHAZIABAD = { lat: 28.6692, lng: 77.4538 };
const LUCKNOW = { lat: 26.8467, lng: 80.9462 };
const MUMBAI = { lat: 19.076, lng: 72.8777 };

interface Row {
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

function office(jurisdiction: string, lat: number, lng: number, radiusKm: number): Row {
  return {
    id: `id-${jurisdiction}`,
    name: `${jurisdiction} office`,
    jurisdiction,
    contact_email: `${jurisdiction}@example.gov.in`,
    source_url: "https://example.gov.in/contact",
    grievance_portal_url: null,
    notes: null,
    lat,
    lng,
    radius_km: radiusKm,
  };
}

// Stands in for the Supabase client's .from().select().eq() chain.
function clientWith(rows: Row[]) {
  return {
    from: () => ({
      select: () => ({
        eq: async () => ({ data: rows, error: null }),
      }),
    }),
  } as never;
}

describe("haversineKm", () => {
  it("measures real distances", () => {
    // Greater Noida to Ghaziabad is roughly 22 km as the crow flies.
    const d = haversineKm(GREATER_NOIDA.lat, GREATER_NOIDA.lng, GHAZIABAD.lat, GHAZIABAD.lng);
    expect(d).toBeGreaterThan(18);
    expect(d).toBeLessThan(28);
    expect(haversineKm(28.4744, 77.504, 28.4744, 77.504)).toBe(0);
  });
});

describe("findMunicipalOfficeFor", () => {
  it("picks the nearest office covering the point", async () => {
    const found = await findMunicipalOfficeFor(
      clientWith([
        office("ghaziabad", GHAZIABAD.lat, GHAZIABAD.lng, 30),
        office("greater-noida", GREATER_NOIDA.lat, GREATER_NOIDA.lng, 30),
      ]),
      GREATER_NOIDA.lat,
      GREATER_NOIDA.lng
    );
    expect(found?.jurisdiction).toBe("greater-noida");
    expect(found?.distanceKm).toBeLessThan(1);
  });

  it("returns nothing when the report is outside every jurisdiction", async () => {
    // A Mumbai pothole must not be mailed to a UP nagar nigam just because it
    // is the only row in the table.
    const found = await findMunicipalOfficeFor(
      clientWith([office("lucknow", LUCKNOW.lat, LUCKNOW.lng, 40)]),
      MUMBAI.lat,
      MUMBAI.lng
    );
    expect(found).toBeNull();
  });

  it("respects each office's own radius rather than just taking the closest", async () => {
    // Lucknow is the only row and it is ~450 km away; a tight radius means no
    // match, even though nothing else competes.
    const rows = [office("lucknow", LUCKNOW.lat, LUCKNOW.lng, 25)];
    expect(
      await findMunicipalOfficeFor(clientWith(rows), GREATER_NOIDA.lat, GREATER_NOIDA.lng)
    ).toBeNull();

    // Widen the same office's radius past the distance and it now matches.
    rows[0].radius_km = 600;
    const found = await findMunicipalOfficeFor(
      clientWith(rows),
      GREATER_NOIDA.lat,
      GREATER_NOIDA.lng
    );
    expect(found?.jurisdiction).toBe("lucknow");
  });

  it("returns nothing when the directory is empty", async () => {
    expect(
      await findMunicipalOfficeFor(clientWith([]), GREATER_NOIDA.lat, GREATER_NOIDA.lng)
    ).toBeNull();
  });
});
