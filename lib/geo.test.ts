import { describe, expect, it } from "vitest";
import { haversineDistanceMeters } from "@/lib/geo";

describe("haversineDistanceMeters", () => {
  it("returns 0 for identical points", () => {
    const p = { lat: 23.3441, lng: 85.3096 };
    expect(haversineDistanceMeters(p, p)).toBe(0);
  });

  it("computes a known short distance accurately", () => {
    // ~0.001 deg lat ≈ 111m at the equator-ish latitudes used here.
    const a = { lat: 23.3441, lng: 85.3096 };
    const b = { lat: 23.345, lng: 85.3096 };
    const distance = haversineDistanceMeters(a, b);
    expect(distance).toBeGreaterThan(90);
    expect(distance).toBeLessThan(110);
  });

  it("is symmetric", () => {
    const a = { lat: 23.3441, lng: 85.3096 };
    const b = { lat: 23.36, lng: 85.32 };
    expect(haversineDistanceMeters(a, b)).toBeCloseTo(
      haversineDistanceMeters(b, a),
      6
    );
  });

  it("computes a known long distance (Ranchi to Delhi, ~1000km great-circle)", () => {
    const ranchi = { lat: 23.3441, lng: 85.3096 };
    const delhi = { lat: 28.6139, lng: 77.209 };
    const distanceKm = haversineDistanceMeters(ranchi, delhi) / 1000;
    expect(distanceKm).toBeGreaterThan(950);
    expect(distanceKm).toBeLessThan(1050);
  });
});
