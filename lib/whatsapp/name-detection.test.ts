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

  it("does not mistake an auto-capitalized sentence-starter for a name", () => {
    expect(extractStatedName("I am Really frustrated with the potholes on my street")).toBeNull();
    expect(extractStatedName("I'm Extremely worried about this")).toBeNull();
    expect(
      extractStatedName("I'm Having a problem with garbage collection near my house")
    ).toBeNull();
    expect(extractStatedName("I am Facing this issue for two weeks now")).toBeNull();
    expect(extractStatedName("I am Sorry for the late photo, here it is")).toBeNull();
    expect(extractStatedName("I'm Sending a photo of the garbage now")).toBeNull();
    // but a real capitalized name right after still works
    expect(extractStatedName("I am Rohit, reporting a pothole")).toBe("Rohit");
  });

  it("does not mistake a refusal to give a name for the name itself", () => {
    expect(extractStatedName("mera naam nahi bataunga")).toBeNull();
    expect(extractStatedName("mera naam bhi yahi hai")).toBeNull();
    expect(extractStatedName("mera naam kya hai")).toBeNull();
    expect(extractStatedName("my name is not important")).toBeNull();
    expect(extractStatedName("my name is private")).toBeNull();
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
