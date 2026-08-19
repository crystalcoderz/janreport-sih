import { describe, it, expect } from "vitest";
import { toCsv } from "@/lib/csv";

describe("toCsv", () => {
  it("joins headers and rows with commas and CRLF", () => {
    expect(toCsv(["A", "B"], [["1", "2"]])).toBe("A,B\r\n1,2");
  });

  it("quotes cells containing commas, quotes, or newlines", () => {
    expect(toCsv(["A"], [['he said "hi", ok']])).toBe(
      'A\r\n"he said ""hi"", ok"'
    );
    expect(toCsv(["A"], [["line1\nline2"]])).toBe('A\r\n"line1\nline2"');
  });

  it("neutralizes formula-injection prefixes so Excel/Sheets can't execute them", () => {
    expect(toCsv(["A"], [["=cmd|'/c calc'!A0"]])).toBe(
      'A\r\n"\t=cmd|\'/c calc\'!A0"'
    );
    expect(toCsv(["A"], [["+1+1"]])).toBe('A\r\n"\t+1+1"');
    expect(toCsv(["A"], [["-1+1"]])).toBe('A\r\n"\t-1+1"');
    expect(toCsv(["A"], [["@SUM(1,1)"]])).toBe('A\r\n"\t@SUM(1,1)"');
  });

  it("leaves ordinary text starting with other characters untouched", () => {
    expect(toCsv(["A"], [["Deep pothole on Main Road"]])).toBe(
      "A\r\nDeep pothole on Main Road"
    );
  });

  it("treats null/undefined as an empty cell", () => {
    expect(toCsv(["A", "B"], [[null, undefined]])).toBe("A,B\r\n,");
  });
});
