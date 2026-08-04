import { describe, expect, it } from "vitest";
import { severityLabel, severityColor } from "@/lib/departments";

describe("severityLabel", () => {
  it("maps the full 1-10 range to a label", () => {
    expect(severityLabel(1)).toBe("Minimal");
    expect(severityLabel(2)).toBe("Minimal");
    expect(severityLabel(3)).toBe("Low");
    expect(severityLabel(4)).toBe("Low");
    expect(severityLabel(5)).toBe("Moderate");
    expect(severityLabel(6)).toBe("Moderate");
    expect(severityLabel(7)).toBe("High");
    expect(severityLabel(8)).toBe("High");
    expect(severityLabel(9)).toBe("Critical");
    expect(severityLabel(10)).toBe("Critical");
  });

  it("clamps out-of-range scores instead of returning undefined", () => {
    expect(severityLabel(0)).toBe("Minimal");
    expect(severityLabel(-5)).toBe("Minimal");
    expect(severityLabel(15)).toBe("Critical");
  });

  it("rounds fractional scores before labeling", () => {
    expect(severityLabel(6.6)).toBe("High"); // rounds to 7
    expect(severityLabel(6.4)).toBe("Moderate"); // rounds to 6
  });
});

describe("severityColor", () => {
  it("returns a distinct color per severity band", () => {
    const colors = new Set([
      severityColor(10),
      severityColor(8),
      severityColor(6),
      severityColor(2),
    ]);
    expect(colors.size).toBe(4);
  });

  it("is consistent at band boundaries", () => {
    expect(severityColor(9)).toBe(severityColor(10));
    expect(severityColor(7)).toBe(severityColor(8));
    expect(severityColor(5)).toBe(severityColor(6));
    expect(severityColor(1)).toBe(severityColor(4));
  });
});
