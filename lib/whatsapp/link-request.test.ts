import { describe, it, expect } from "vitest";
import { isLinkRequest } from "@/lib/whatsapp/link-request";

describe("isLinkRequest", () => {
  it("catches the exact phrasing that produced a hallucinated fake URL in production", () => {
    expect(isLinkRequest("Can I get magic link")).toBe(true);
    expect(isLinkRequest("Can I see my reports")).toBe(false);
  });

  it("recognizes common variations", () => {
    expect(isLinkRequest("send me a link")).toBe(true);
    expect(isLinkRequest("give me the link")).toBe(true);
    expect(isLinkRequest("share a link please")).toBe(true);
    expect(isLinkRequest("web link")).toBe(true);
    expect(isLinkRequest("browser link please")).toBe(true);
    expect(isLinkRequest("portal link")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isLinkRequest("MAGIC LINK")).toBe(true);
    expect(isLinkRequest("Magic Link please")).toBe(true);
  });

  it("catches a bare link reply to the bot's own offer", () => {
    // The real conversation that looped: the bot offered a link and none of
    // these reached the deterministic handler.
    expect(isLinkRequest("Yes link")).toBe(true);
    expect(isLinkRequest("Link of existing")).toBe(true);
    expect(isLinkRequest("link")).toBe(true);
    expect(isLinkRequest("links")).toBe(true);
  });

  it("ignores a link road, which is a road and not a request", () => {
    expect(isLinkRequest("pothole on the link road near my house")).toBe(false);
    expect(isLinkRequest("Link Road is flooded")).toBe(false);
  });

  it("does not fire on unrelated messages", () => {
    expect(isLinkRequest("there is a pothole near my house")).toBe(false);
    expect(isLinkRequest("what is the status of my report")).toBe(false);
    expect(isLinkRequest("hi")).toBe(false);
    expect(isLinkRequest("")).toBe(false);
  });
});
