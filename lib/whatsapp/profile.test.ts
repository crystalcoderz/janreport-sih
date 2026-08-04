import { describe, expect, it } from "vitest";
import { shadowEmailFor } from "@/lib/whatsapp/profile";

describe("shadowEmailFor", () => {
  it("is deterministic for the same phone number", () => {
    expect(shadowEmailFor("+919876543210")).toBe(shadowEmailFor("+919876543210"));
  });

  it("strips non-digit characters (the leading +) from the local part", () => {
    expect(shadowEmailFor("+919876543210")).toBe(
      "wa-919876543210@whatsapp.janreport.internal"
    );
  });

  it("produces different addresses for different numbers", () => {
    expect(shadowEmailFor("+919876543210")).not.toBe(shadowEmailFor("+919876543211"));
  });

  it("always targets the internal shadow domain", () => {
    expect(shadowEmailFor("+15551234567")).toMatch(/@whatsapp\.janreport\.internal$/);
  });
});
