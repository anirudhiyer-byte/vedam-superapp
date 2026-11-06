import { describe, expect, it } from "vitest";
import { DOC_MAX_BYTES, MERGE_FIELDS, SAMPLE_VALUES, byteLength, nameOk, scanMergeFields } from "./doc-template-rules";

describe("merge fields", () => {
  it("the allowed list is exactly the five agreed fields", () => {
    expect([...MERGE_FIELDS]).toEqual(["first_name", "full_name", "vsat_id", "campus", "today"]);
  });
  it("known fields are found (distinct, sorted)", () => {
    expect(scanMergeFields("Hi {{first_name}}, {{campus}} on {{today}}. {{first_name}}")).toEqual({ fields: ["campus", "first_name", "today"], unknown: [] });
  });
  it("text without fields is fine", () => {
    expect(scanMergeFields("plain text, {single} braces")).toEqual({ fields: [], unknown: [] });
  });
  it.each([
    ["{{email}}", "email"], ["{{phone}}", "phone"], ["{{ first_name }}", " first_name "], ["{{First_Name}}", "First_Name"],
    ["{{constructor}}", "constructor"], ["{{__proto__}}", "__proto__"], ["{{toString}}", "toString"], ["{{hasOwnProperty}}", "hasOwnProperty"],
    ["{{}}", ""], ["{{first_name.length}}", "first_name.length"], ["{{full_name|raw}}", "full_name|raw"],
  ])("unknown field %s is reported", (text, name) => {
    expect(scanMergeFields(text).unknown).toContain(name);
  });
  it.each(["{{first_name", "first_name}}", "{{{first_name}}}", "{{ {{first_name}} }}", "{{" + "x".repeat(70) + "}}"])("stray or broken braces are reported: %s", (text) => {
    expect(scanMergeFields(text).unknown.length).toBeGreaterThan(0);
  });
  it("sample values are fake only and frozen", () => {
    expect(SAMPLE_VALUES.full_name).toBe("Test Student");
    expect(Object.isFrozen(SAMPLE_VALUES)).toBe(true);
    expect(JSON.stringify(SAMPLE_VALUES)).not.toMatch(/@|\d{10}/);
  });
});

describe("limits", () => {
  it("names: 1–80 characters after trimming, no control characters", () => {
    expect(nameOk("Offer letter")).toBe(true);
    expect(nameOk("  x  ")).toBe(true);
    expect(nameOk("n".repeat(80))).toBe(true);
    for (const bad of ["", "   ", "n".repeat(81), "a\nb", "a\u0000b", 5, null]) expect(nameOk(bad)).toBe(false);
  });
  it("size is counted in UTF-8 bytes", () => {
    expect(DOC_MAX_BYTES).toBe(102400);
    expect(byteLength("é")).toBe(2);
    expect(byteLength("abc")).toBe(3);
  });
});
