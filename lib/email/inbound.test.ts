import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import {
  bareAddress,
  extractNewText,
  findReference,
  htmlToText,
  isValidSignature,
  matchesAllowlist,
} from "@/lib/email/inbound";

const SECRET = "whsec_dGVzdHNlY3JldGZvcnVuaXR0ZXN0aW5nMTIzNA==";

// Build the header exactly the way Svix does, so these tests fail if the
// verification drifts from the real scheme rather than from our idea of it.
function signed(body: string, opts: { id?: string; ts?: number; secret?: string } = {}) {
  const id = opts.id ?? "msg_test";
  const ts = opts.ts ?? Math.floor(Date.now() / 1000);
  const key = Buffer.from((opts.secret ?? SECRET).replace(/^whsec_/, ""), "base64");
  const sig = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
  return new Headers({
    "svix-id": id,
    "svix-timestamp": String(ts),
    "svix-signature": `v1,${sig}`,
  });
}

describe("extractNewText", () => {
  it("keeps only what the sender typed above the quoted history", () => {
    const body = "Work order raised, crew visits Tuesday.\n\nOn Mon, JanReport wrote:\n> original";
    expect(extractNewText(body)).toBe("Work order raised, crew visits Tuesday.");
  });

  it("returns nothing when the message opens with quoted history", () => {
    // A quote marker at index 0 means there is no new text at all. Treating
    // index 0 as "not found" would relay the entire thread back to the citizen.
    expect(extractNewText("> the whole thing is quoted\n> second line")).toBe("");
    expect(extractNewText("On Mon, JanReport wrote:\n> quoted")).toBe("");
  });

  it("keeps the whole body when there is no quote marker", () => {
    expect(extractNewText("Pothole repaired on Tuesday.")).toBe("Pothole repaired on Tuesday.");
  });

  it("caps very long replies", () => {
    expect(extractNewText("x".repeat(4000))).toHaveLength(1500);
  });
});

describe("htmlToText", () => {
  it("drops stylesheet and script content instead of relaying it as the reply", () => {
    const html = "<style>.a{color:red}</style><p>Crew dispatched.</p>";
    const out = htmlToText(html);
    expect(out).toContain("Crew dispatched.");
    expect(out).not.toContain("color:red");
  });

  it("turns HTML quoting into a marker extractNewText understands", () => {
    const html = "<p>Noted, work scheduled.</p><blockquote><p>your complaint</p></blockquote>";
    expect(extractNewText(htmlToText(html))).toBe("Noted, work scheduled.");
  });

  it("decodes entities without decoding twice", () => {
    // &amp;lt; must survive as the literal text "&lt;", never become a tag.
    expect(htmlToText("<p>Sector 5 &amp; 6</p>")).toContain("Sector 5 & 6");
    expect(htmlToText("<p>&amp;lt;b&amp;gt;</p>")).toContain("&lt;b&gt;");
  });
});

describe("findReference", () => {
  it("finds the reference in the plus-address, the subject, or the body", () => {
    expect(findReference("reports+JR-2608-9044@janreport.xyz", "", "")).toBe("JR-2608-9044");
    expect(findReference("", "Re: JR-2608-0001 pothole", "")).toBe("JR-2608-0001");
    expect(findReference("", "", "regarding JR-2512-1234 please")).toBe("JR-2512-1234");
  });

  it("normalises case and returns null when there is none", () => {
    expect(findReference("jr-2608-9044")).toBe("JR-2608-9044");
    expect(findReference("no reference here", "", "")).toBeNull();
    expect(findReference("JR-26-9044")).toBeNull();
  });
});

describe("isValidSignature", () => {
  const env = { RESEND_WEBHOOK_SECRET: SECRET };
  const body = '{"type":"email.received"}';

  it("accepts a genuine Svix signature", () => {
    expect(isValidSignature(body, signed(body), env)).toBe(true);
  });

  it("accepts a rotation header carrying several candidate signatures", () => {
    // During a secret rotation Svix sends space-separated "v1,<sig>" pairs and
    // any one of them matching is a pass.
    const h = signed(body);
    h.set("svix-signature", `v1,bm90YXJlYWxzaWc= ${h.get("svix-signature")}`);
    expect(isValidSignature(body, h, env)).toBe(true);
  });

  it("rejects a tampered signature and a tampered body", () => {
    const h = signed(body);
    h.set("svix-signature", "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");
    expect(isValidSignature(body, h, env)).toBe(false);
    expect(isValidSignature('{"type":"tampered"}', signed(body), env)).toBe(false);
  });

  it("rejects a stale timestamp so a captured request cannot be replayed", () => {
    const old = Math.floor(Date.now() / 1000) - 1200;
    expect(isValidSignature(body, signed(body, { ts: old }), env)).toBe(false);
  });

  it("rejects when the headers are missing entirely", () => {
    expect(isValidSignature(body, new Headers(), env)).toBe(false);
  });

  it("fails closed when the secret is not configured", () => {
    // The dangerous default would be to accept: this endpoint relays messages
    // to citizens as their municipal office.
    expect(isValidSignature(body, signed(body), {})).toBe(false);
    expect(
      isValidSignature(body, signed(body), { RESEND_WEBHOOK_SECRET: "" })
    ).toBe(false);
  });

  it("never honours the unsigned escape hatch in production", () => {
    const prod = { INBOUND_ALLOW_UNSIGNED: "1", NODE_ENV: "production" };
    expect(isValidSignature(body, new Headers(), prod)).toBe(false);
  });
});

describe("matchesAllowlist", () => {
  it("refuses everything when nothing is configured", () => {
    expect(matchesAllowlist("clerk@nagarnigam.gov.in", [])).toBe(false);
    expect(matchesAllowlist("clerk@nagarnigam.gov.in", [null, "", undefined])).toBe(false);
  });

  it("accepts the exact configured address, however it is formatted", () => {
    const list = ["Commissioner@NagarNigam.gov.in"];
    expect(matchesAllowlist("commissioner@nagarnigam.gov.in", list)).toBe(true);
    expect(matchesAllowlist("Nagar Nigam <commissioner@nagarnigam.gov.in>", list)).toBe(true);
  });

  it("accepts a colleague at the same office", () => {
    // A complaint addressed to the commissioner is routinely answered by a clerk.
    expect(matchesAllowlist("clerk@nagarnigam.gov.in", ["commissioner@nagarnigam.gov.in"])).toBe(
      true
    );
  });

  it("accepts a bare domain entry", () => {
    expect(matchesAllowlist("anyone@pwd.jharkhand.gov.in", ["pwd.jharkhand.gov.in"])).toBe(true);
  });

  it("rejects strangers and lookalike domains", () => {
    const list = ["commissioner@nagarnigam.gov.in"];
    expect(matchesAllowlist("attacker@gmail.com", list)).toBe(false);
    expect(matchesAllowlist("attacker@nagarnigam.gov.in.evil.com", list)).toBe(false);
    expect(matchesAllowlist("attacker@evil-nagarnigam.gov.in", list)).toBe(false);
    expect(matchesAllowlist("not-an-address", list)).toBe(false);
  });
});

describe("bareAddress", () => {
  it("unwraps a display name", () => {
    expect(bareAddress("Nagar Nigam <Clerk@Office.GOV.in>")).toBe("clerk@office.gov.in");
    expect(bareAddress("  clerk@office.gov.in ")).toBe("clerk@office.gov.in");
  });
});
