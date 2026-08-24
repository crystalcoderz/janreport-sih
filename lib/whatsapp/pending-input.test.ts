import { describe, it, expect, vi, beforeEach } from "vitest";
import { looksLikeBareName, resolvePendingReportInput, containsIssueWord } from "@/lib/whatsapp/pending-input";
import { forwardGeocode } from "@/lib/geo";

// Must be vi.mock, not vi.spyOn: pending-input.ts imports forwardGeocode
// as a live ESM binding, so a namespace spy doesn't intercept it and the
// test silently calls the real Google API instead.
vi.mock("@/lib/geo", () => ({ forwardGeocode: vi.fn() }));
const mockGeocode = vi.mocked(forwardGeocode);

describe("looksLikeBareName", () => {
  it("accepts the bare names citizens actually type", () => {
    expect(looksLikeBareName("ritvik")).toBe(true);
    expect(looksLikeBareName("Rohit Sharma")).toBe(true);
    expect(looksLikeBareName("Md. Irfan Ansari")).toBe(true);
  });

  it("rejects anything carrying a place word", () => {
    expect(looksLikeBareName("iilm university")).toBe(false);
    expect(looksLikeBareName("narendra modi residence")).toBe(false);
    expect(looksLikeBareName("sector 62")).toBe(false);
    expect(looksLikeBareName("near city hospital")).toBe(false);
  });

  it("rejects questions and commands that happen to be short", () => {
    expect(looksLikeBareName("my reports")).toBe(false);
    expect(looksLikeBareName("what is this")).toBe(false);
    expect(looksLikeBareName("cancel")).toBe(false);
    expect(looksLikeBareName("hi")).toBe(false);
  });

  it("rejects a description of the issue, which is also short and name-shaped", () => {
    // Otherwise the acknowledgement letter goes out "Dear big pothole here,".
    expect(looksLikeBareName("big pothole here")).toBe(false);
    expect(looksLikeBareName("garbage")).toBe(false);
    expect(looksLikeBareName("water leaking")).toBe(false);
    expect(looksLikeBareName("streetlight not working")).toBe(false);
    expect(looksLikeBareName("broken wire")).toBe(false);
    expect(looksLikeBareName("very dirty")).toBe(false);
    expect(looksLikeBareName("urgent please fix")).toBe(false);
  });

  it("rejects sentences", () => {
    expect(
      looksLikeBareName("there is a really big pothole outside my house here")
    ).toBe(false);
  });
});

describe("resolvePendingReportInput", () => {
  beforeEach(() => mockGeocode.mockReset());

  it("saves a precise place as the location — the exact case that silently failed in production", async () => {
    mockGeocode.mockResolvedValue({
      lat: 28.46,
      lng: 77.53,
      formattedAddress: "Plot No.18, Knowledge Park II, Greater Noida, Uttar Pradesh, India",
      specificity: "precise",
    });
    const result = await resolvePendingReportInput({
      text: "iilm university",
      hasLocation: false,
      hasName: false,
    });
    expect(result?.kind).toBe("location");
  });

  it("treats a bare name as a name even though it geocodes precisely", async () => {
    // Not hypothetical: "deepak" really does return "Deepak, Anushakti
    // Nagar, Mumbai" as a precise establishment hit, so specificity alone
    // cannot tell it apart from a place the citizen meant.
    mockGeocode.mockResolvedValue({
      lat: 19.03,
      lng: 72.93,
      formattedAddress: "Deepak, Anushakti Nagar, Mumbai, Maharashtra, India",
      specificity: "precise",
    });
    expect(
      await resolvePendingReportInput({
        text: "deepak",
        hasLocation: false,
        hasName: false,
      })
    ).toEqual({ kind: "name", name: "deepak" });
    expect(mockGeocode).not.toHaveBeenCalled();
  });

  it("reads the same bare word as a location once the name is already on file", async () => {
    mockGeocode.mockResolvedValue({
      lat: 23.34,
      lng: 85.31,
      formattedAddress: "Ranchi, Jharkhand, India",
      specificity: "locality",
    });
    const result = await resolvePendingReportInput({
      text: "ranchi",
      hasLocation: false,
      hasName: true,
    });
    expect(result?.kind).toBe("location");
  });

  it("ignores a country-level collapse rather than pinning the middle of India", async () => {
    mockGeocode.mockResolvedValue({
      lat: 20.59,
      lng: 78.96,
      formattedAddress: "India",
      specificity: "coarse",
    });
    // Not a location (too coarse) and not a name (says "residence").
    expect(
      await resolvePendingReportInput({
        text: "narendra modi residence",
        hasLocation: false,
        hasName: false,
      })
    ).toBeNull();
  });

  it("does nothing once both fields are already filled", async () => {
    expect(
      await resolvePendingReportInput({
        text: "iilm university",
        hasLocation: true,
        hasName: true,
      })
    ).toBeNull();
    expect(mockGeocode).not.toHaveBeenCalled();
  });

  it("never hijacks a question as an answer", async () => {
    expect(
      await resolvePendingReportInput({
        text: "my reports",
        hasLocation: false,
        hasName: false,
      })
    ).toBeNull();
    expect(mockGeocode).not.toHaveBeenCalled();
  });
});

describe("containsIssueWord", () => {
  it("recognises a description of the problem", () => {
    // These used to be handed to the geocoder as a bare answer and pinned as
    // the report's location.
    for (const t of ["big pothole", "garbage", "street light not working", "open manhole"]) {
      expect(containsIssueWord(t)).toBe(true);
    }
  });

  it("leaves real places alone", () => {
    for (const t of ["sector 62 noida", "iilm university", "gomti nagar", "pari chowk"]) {
      expect(containsIssueWord(t)).toBe(false);
    }
  });
});
