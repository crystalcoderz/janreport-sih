import { describe, it, expect } from "vitest";
import { extractStatedName } from "@/lib/whatsapp/name-detection";

describe("extractStatedName", () => {
  it("catches the exact phrasing that silently broke report filing in production", () => {
    expect(extractStatedName("My name is Rohit Sharma")).toBe("Rohit Sharma");
  });

  it("is case-insensitive on the anchor phrase", () => {
    expect(extractStatedName("my name is Aarav")).toBe("Aarav");
    expect(extractStatedName("MY NAME IS Priya")).toBe("Priya");
  });

  it("understands romanized Hindi", () => {
    expect(extractStatedName("mera naam Rohit hai")).toBe("Rohit");
    expect(extractStatedName("mera naam Sneha Devi")).toBe("Sneha Devi");
  });

  it("accepts a capitalized name after I am / I'm", () => {
    expect(extractStatedName("I am Vikram Oraon")).toBe("Vikram Oraon");
    expect(extractStatedName("I'm Rohit")).toBe("Rohit");
  });

  it("does not mistake an ordinary sentence for a name after I am/I'm", () => {
    expect(extractStatedName("I am facing this issue for two weeks")).toBeNull();
    expect(extractStatedName("I'm not sure where this is")).toBeNull();
    expect(extractStatedName("i am reporting a pothole")).toBeNull();
  });

  it("returns null when there's no name statement at all", () => {
    expect(extractStatedName("There is a pothole near my house")).toBeNull();
    expect(extractStatedName("hi")).toBeNull();
    expect(extractStatedName("")).toBeNull();
  });

  it("finds the name within a longer message", () => {
    expect(
      extractStatedName("Hi there, my name is Deepak and there's a big pothole here")
    ).toBe("Deepak");
  });

  it("caps how many words it treats as the name", () => {
    const result = extractStatedName(
      "my name is Word One Two Three Four Five Six Seven"
    );
    expect(result?.split(/\s+/).length).toBeLessThanOrEqual(4);
  });
});
