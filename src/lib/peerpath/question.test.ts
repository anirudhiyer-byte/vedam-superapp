import { describe, expect, it } from "vitest";
import { cleanQuestion } from "./question";

describe("cleanQuestion", () => {
  it("returns null for an empty string", () => {
    expect(cleanQuestion("")).toBeNull();
  });
  it("returns null for spaces only", () => {
    expect(cleanQuestion("   ")).toBeNull();
  });
  it("returns null for newline and tab only", () => {
    expect(cleanQuestion("\n\t")).toBeNull();
  });
  it("returns a normal question as it is", () => {
    expect(cleanQuestion("How?")).toBe("How?");
  });
  it("trims spaces around a question", () => {
    expect(cleanQuestion("  How?  ")).toBe("How?");
  });
  it("keeps a 500-character question whole", () => {
    const q = "a".repeat(500);
    expect(cleanQuestion(q)).toBe(q);
  });
  it("returns null for a non-string value", () => {
    expect(cleanQuestion(null)).toBeNull();
    expect(cleanQuestion(undefined)).toBeNull();
  });
});
