import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { looksLikeAllowedImage, isAllowedPhotoUrl } from "@/lib/storage";

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function ascii(text: string, pad = 0): Uint8Array {
  const out = new Uint8Array(text.length + pad);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out;
}

describe("looksLikeAllowedImage", () => {
  it("accepts a JPEG signature", () => {
    expect(looksLikeAllowedImage(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00))).toBe(true);
  });

  it("accepts a PNG signature", () => {
    expect(
      looksLikeAllowedImage(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00))
    ).toBe(true);
  });

  it("accepts a WebP signature", () => {
    const webp = ascii("RIFF____WEBPVP8 ");
    expect(looksLikeAllowedImage(webp)).toBe(true);
  });

  it("rejects SVG, which would be stored XSS on a public origin", () => {
    expect(looksLikeAllowedImage(ascii("<svg xmlns='http://www.w3.org/2000/svg'>"))).toBe(
      false
    );
  });

  it("rejects arbitrary bytes merely labelled as an image", () => {
    expect(looksLikeAllowedImage(ascii("#!/bin/sh\nrm -rf /"))).toBe(false);
  });

  it("rejects truncated input without throwing", () => {
    expect(looksLikeAllowedImage(bytes())).toBe(false);
    expect(looksLikeAllowedImage(bytes(0xff))).toBe(false);
    expect(looksLikeAllowedImage(ascii("RIFF"))).toBe(false);
  });
});

describe("isAllowedPhotoUrl", () => {
  const SUPABASE = "https://ipxyvstgrzjuknndabet.supabase.co";

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE;
  });
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  });

  it("accepts a URL on the configured storage host", () => {
    expect(
      isAllowedPhotoUrl(`${SUPABASE}/storage/v1/object/public/issue-photos/a/b.jpg`)
    ).toBe(true);
  });

  it("rejects cloud metadata (the SSRF case that matters most)", () => {
    expect(isAllowedPhotoUrl("http://169.254.169.254/latest/meta-data/")).toBe(false);
  });

  it("rejects internal hosts and loopback", () => {
    expect(isAllowedPhotoUrl("http://localhost:3000/admin")).toBe(false);
    expect(isAllowedPhotoUrl("https://10.0.0.5/internal")).toBe(false);
  });

  it("rejects an unrelated external host", () => {
    expect(isAllowedPhotoUrl("https://evil.example.com/x.jpg")).toBe(false);
  });

  it("rejects non-https schemes", () => {
    expect(isAllowedPhotoUrl(`http://${SUPABASE.replace("https://", "")}/x.jpg`)).toBe(
      false
    );
    expect(isAllowedPhotoUrl("file:///etc/passwd")).toBe(false);
  });

  it("rejects a host that merely embeds the allowed one", () => {
    expect(
      isAllowedPhotoUrl("https://ipxyvstgrzjuknndabet.supabase.co.evil.com/x.jpg")
    ).toBe(false);
    expect(isAllowedPhotoUrl(`https://evil.com/?next=${SUPABASE}/x.jpg`)).toBe(false);
  });

  it("rejects malformed input without throwing", () => {
    expect(isAllowedPhotoUrl("not a url")).toBe(false);
    expect(isAllowedPhotoUrl("")).toBe(false);
  });
});
