import { describe, it, expect } from "vitest";
import {
  extractEmail,
  isEmailDecline,
  claimsOwnEmail,
} from "@/lib/whatsapp/email-detection";

describe("extractEmail", () => {
  it("pulls an address out of a sentence", () => {
    expect(extractEmail("my email is Prayaas.XXD@Gmail.com")).toBe("prayaas.xxd@gmail.com");
    expect(extractEmail("ritvik_k99@yahoo.co.in")).toBe("ritvik_k99@yahoo.co.in");
    expect(extractEmail("send it to a.b+tag@sub.domain.org please")).toBe("a.b+tag@sub.domain.org");
  });

  it("survives phone-keyboard spacing and trailing punctuation", () => {
    expect(extractEmail("prayaas @ gmail.com")).toBe("prayaas@gmail.com");
    expect(extractEmail("Mail me at rohit@gmail.com.")).toBe("rohit@gmail.com");
  });

  it("returns null when there is no address", () => {
    expect(extractEmail("Prayas Sharma")).toBeNull();
    expect(extractEmail("sector 62 noida")).toBeNull();
    expect(extractEmail("")).toBeNull();
    // A bare handle is not an address and must not be stored as one.
    expect(extractEmail("@prayaas")).toBeNull();
  });
});

describe("isEmailDecline", () => {
  it("recognises a citizen declining, in English and Hinglish", () => {
    for (const t of ["no", "skip", "nahi", "nhi", "dont have", "no email", "not now"]) {
      expect(isEmailDecline(t)).toBe(true);
    }
  });

  it("does not mistake an address or a name for a decline", () => {
    expect(isEmailDecline("rohit@gmail.com")).toBe(false);
    expect(isEmailDecline("Naveen")).toBe(false);
  });
});

describe("claimsOwnEmail", () => {
  it("accepts an address the citizen presents as theirs", () => {
    for (const t of [
      "my email is a@b.com",
      "My Mail ID: a@b.com",
      "mera email a@b.com hai",
      "mail me at a@b.com",
      "email me on a@b.com",
    ]) {
      expect(claimsOwnEmail(t)).toBe(true);
    }
  });

  it("rejects an address that belongs to somebody else", () => {
    // Storing one of these as the reporter's would email a stranger their
    // report, and stop the bot ever asking for the citizen's own address.
    for (const t of [
      "the contractor is at works@example.com",
      "I already wrote to pwd@example.gov.in",
      "complaint copy went to commissioner@nagarnigam.gov.in",
    ]) {
      expect(claimsOwnEmail(t)).toBe(false);
    }
  });
});
