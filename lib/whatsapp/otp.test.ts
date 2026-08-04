import { describe, expect, it } from "vitest";
import { normalizePhone } from "@/lib/whatsapp/otp";

describe("normalizePhone", () => {
  it("adds a leading + when missing", () => {
    expect(normalizePhone("919876543210")).toBe("+919876543210");
  });

  it("keeps an existing leading +", () => {
    expect(normalizePhone("+919876543210")).toBe("+919876543210");
  });

  it("strips spaces, dashes, and parens", () => {
    expect(normalizePhone("+91 98765-43210")).toBe("+919876543210");
    expect(normalizePhone("(91) 9876543210")).toBe("+919876543210");
  });

  it("rejects numbers that are too short", () => {
    expect(normalizePhone("12345")).toBeNull();
  });

  it("rejects numbers that are too long", () => {
    expect(normalizePhone("+1234567890123456")).toBeNull();
  });

  it("rejects a leading zero (invalid country-code position)", () => {
    expect(normalizePhone("0123456789")).toBeNull();
  });

  it("rejects non-numeric input", () => {
    expect(normalizePhone("not-a-phone")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });
});
