import { describe, it, expect } from "vitest";
import { isCancelRequest } from "@/lib/whatsapp/cancel-request";

describe("isCancelRequest", () => {
  it("catches the exact phrasing that the agent silently ignored in production", () => {
    expect(isCancelRequest("cancel")).toBe(true);
  });

  it("recognizes common variations", () => {
    expect(isCancelRequest("never mind")).toBe(true);
    expect(isCancelRequest("nevermind")).toBe(true);
    expect(isCancelRequest("forget it")).toBe(true);
    expect(isCancelRequest("forget that")).toBe(true);
    expect(isCancelRequest("start over")).toBe(true);
    expect(isCancelRequest("scrap this")).toBe(true);
    expect(isCancelRequest("please cancel this report")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isCancelRequest("CANCEL")).toBe(true);
    expect(isCancelRequest("Never Mind")).toBe(true);
  });

  it("does not fire on unrelated messages", () => {
    expect(isCancelRequest("there is a pothole near my house")).toBe(false);
    expect(isCancelRequest("what is the status of my report")).toBe(false);
    expect(isCancelRequest("hi")).toBe(false);
    expect(isCancelRequest("")).toBe(false);
  });

  it("does not false-positive on a word merely containing 'cancel'", () => {
    expect(isCancelRequest("is there a cancellation policy")).toBe(false);
  });
});
