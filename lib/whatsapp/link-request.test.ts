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

  it("does not fire on unrelated messages", () => {
    expect(isLinkRequest("there is a pothole near my house")).toBe(false);
    expect(isLinkRequest("what is the status of my report")).toBe(false);
    expect(isLinkRequest("hi")).toBe(false);
    expect(isLinkRequest("")).toBe(false);
  });
});
