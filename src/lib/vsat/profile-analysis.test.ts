import { describe, expect, it } from "vitest";
import { PROFILE_Q_MAX, fieldRows, hitText, lookupParams, matchText } from "./profile-analysis";

describe("Profile Analysis (Phase 7, 0191)", () => {
  it("lookupParams: the VSAT, and the search words only when there are some (trimmed, capped)", () => {
    expect(lookupParams("", "")).toEqual({});
    expect(lookupParams("vs-1", "   ")).toEqual({ exam_date_id: "vs-1" });
    expect(lookupParams("vs-1", "  Vedam-54231 ")).toEqual({ exam_date_id: "vs-1", q: "Vedam-54231" });
    expect(lookupParams("vs-1", "x".repeat(200)).q).toHaveLength(PROFILE_Q_MAX);
  });
  it("matchText: none, all, or a cut list", () => {
    expect(matchText(0, 0)).toBe("No students match.");
    expect(matchText(1, 1)).toBe("1 student");
    expect(matchText(3, 3)).toBe("3 students");
    expect(matchText(25, 40)).toBe("Showing 25 of 40. Type more of the ID or name to narrow it.");
  });
  it("hitText: name · application no, falling back to the id", () => {
    expect(hitText({ name: "Asha", application_no: "V-1", application_id: "A1" })).toBe("Asha · V-1");
    expect(hitText({ name: null, application_no: null, application_id: "A1" })).toBe("A1");
  });
  it("fieldRows keeps only [label, value] string pairs", () => {
    expect(fieldRows([["VPS (out of 10)", "8.43"], ["bad"], [1, "x"], "x", ["Name", "Asha"]])).toEqual([["VPS (out of 10)", "8.43"], ["Name", "Asha"]]);
    expect(fieldRows(null)).toEqual([]);
  });
});
