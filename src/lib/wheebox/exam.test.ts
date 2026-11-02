import { describe, it, expect } from "vitest";
import { extractLaunchUrl, extractAuthToken, isWheeboxOk, parseWheeboxResult, studentMockResult } from "./exam";

describe("extractLaunchUrl", () => {
  it("finds a direct url field", () => {
    expect(extractLaunchUrl({ url: "https://uat.wheebox.com/x" })).toBe("https://uat.wheebox.com/x");
  });
  it("finds a testLink alias", () => {
    expect(extractLaunchUrl({ status: "success", testLink: "https://a.b/t" })).toBe("https://a.b/t");
  });
  it("digs into nested data/result", () => {
    expect(extractLaunchUrl({ data: { loginUrl: "https://a.b/login" } })).toBe("https://a.b/login");
  });
  it("falls back to any https string value", () => {
    expect(extractLaunchUrl({ foo: "https://a.b/z" })).toBe("https://a.b/z");
  });
  it("returns null when no url present", () => {
    expect(extractLaunchUrl({ status: "success", token: "abc" })).toBeNull();
    expect(extractLaunchUrl("nope")).toBeNull();
  });
});

describe("extractAuthToken", () => {
  it("reads clientRequestToken", () => {
    expect(extractAuthToken({ clientRequestToken: "tok123" })).toBe("tok123");
  });
  it("returns null when absent", () => {
    expect(extractAuthToken({ url: "https://a.b" })).toBeNull();
  });
});

describe("isWheeboxOk", () => {
  it("accepts explicit success", () => {
    expect(isWheeboxOk({ status: "success" })).toBe(true);
  });
  it("treats 'already registered' error as a soft-OK (idempotent register)", () => {
    expect(isWheeboxOk({ status: "error", message: "Candidate already exists" })).toBe(true);
  });
  it("rejects a real error", () => {
    expect(isWheeboxOk({ status: "error", message: "Invalid access token" })).toBe(false);
  });
  it("accepts a bare object with no status marker", () => {
    expect(isWheeboxOk({ testNo: 169872 })).toBe(true);
  });
});

describe("parseWheeboxResult", () => {
  it("parses a flat overall + sectionwise array", () => {
    const p = parseWheeboxResult({
      obtainedMarks: 42, maxMarks: 60, percentile: 88.5, result: "Pass",
      sectionwise: [{ name: "Maths", marks: 20 }, { name: "CS", marks: 22 }],
    });
    expect(p.obtainedMarks).toBe(42);
    expect(p.maxMarks).toBe(60);
    expect(p.percentile).toBe(88.5);
    expect(p.overall).toBe("Pass");
    expect(p.sections).toEqual({ Maths: 20, CS: 22 });
  });
  it("parses numbers given as strings and a nested overall block", () => {
    const p = parseWheeboxResult({ overall: { obtained_marks: "30", total_marks: "50", percentile: "70" } });
    expect(p.obtainedMarks).toBe(30);
    expect(p.maxMarks).toBe(50);
    expect(p.percentile).toBe(70);
  });
  it("is safe on junk", () => {
    const p = parseWheeboxResult("boom");
    expect(p).toEqual({ overall: null, obtainedMarks: null, maxMarks: null, percentile: null, sections: {} });
  });
  it("parses the real Wheebox OVERALL callback shape (maximumMark / obtainMark)", () => {
    const p = parseWheeboxResult({
      OVERALL: { result: "Pass", emailId: "VSAT-123", testName: "VSAT 1", maximumMark: "40", obtainMark: "28" },
    });
    expect(p.overall).toBe("Pass");
    expect(p.obtainedMarks).toBe(28);
    expect(p.maxMarks).toBe(40);
    expect(p.percentile).toBeNull(); // Wheebox OVERALL carries no percentile — VPS is our own
  });
  it("parses the real Wheebox SECTIONWISE object array (markObtainInSection)", () => {
    const p = parseWheeboxResult({
      SECTIONWISE: [
        { sectionName: "Maths", markObtainInSection: "9", maximumMarkInSection: "40" },
        { sectionName: "CS", markObtainInSection: "12", maximumMarkInSection: "40" },
      ],
    });
    expect(p.sections).toEqual({ Maths: "9", CS: "12" });
  });
});

describe("studentMockResult", () => {
  it("builds a compact student-facing shape", () => {
    const out = studentMockResult({ overall: "Pass", obtainedMarks: 42, maxMarks: 60, percentile: 88.5, sections: { Maths: 20 } });
    expect(out).toEqual({ Score: "42 / 60", Percentile: 88.5, Result: "Pass", Sections: { Maths: 20 } });
  });
  it("omits missing fields", () => {
    expect(studentMockResult({ overall: null, obtainedMarks: null, maxMarks: null, percentile: null, sections: {} })).toEqual({});
  });
});
