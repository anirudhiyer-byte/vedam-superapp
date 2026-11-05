import { describe, expect, it } from "vitest";
import { conditionsSchema, createBody, listsQuery, previewBody, updateBody } from "./lists";
import { parseQuery } from "./params";

const ok = (v: unknown) => conditionsSchema.safeParse(v).success;

describe("conditions whitelist", () => {
  it("normal: every allowed key with a good value", () => {
    expect(ok({
      lead_stage: ["applicant_paid", "applicant_unpaid"], application_stage: ["payment_approved"], lead_source: ["VSAT"],
      utm_source: ["google"], utm_campaign: ["oct_vsat"], campus: ["Gurugram (Sushant University)"], state: ["Haryana"], city: ["Gurugram"],
      grad_year: [2026, 2027], signup: { from: "2026-10-01", to: "2026-10-31" }, vsat_registered: true, exam_assigned: false,
      exam_given: false, payment: "started_not_paid", consent_given: true,
    })).toBe(true);
  });
  it("edge: empty object = everyone; one-day signup range; 20 values; 100-char value", () => {
    expect(ok({})).toBe(true);
    expect(ok({ signup: { from: "2026-10-01", to: "2026-10-01" } })).toBe(true);
    expect(ok({ city: Array.from({ length: 20 }, (_, i) => `c${i}`) })).toBe(true);
    expect(ok({ state: ["s".repeat(100)] })).toBe(true);
  });
  it("invalid: unknown keys, including protected fields", () => {
    for (const k of ["full_name", "date_of_birth", "aadhaar", "scholarship_amount", "father_mobile", "owner_id", "__proto__x"]) {
      expect(ok({ [k]: ["x"] }), k).toBe(false);
    }
  });
  it("invalid: wrong types and shapes", () => {
    for (const v of [
      { lead_stage: "applicant_paid" }, { lead_stage: [] }, { lead_stage: ["hacker"] }, { application_stage: ["drop table"] },
      { state: [1] }, { state: ["s".repeat(101)] }, { state: ["a\tb"] }, { city: Array.from({ length: 21 }, (_, i) => `c${i}`) },
      { grad_year: [1999] }, { grad_year: ["2026"] }, { grad_year: [2026.5] }, { signup: { from: "2026-10-07", to: "2026-10-01" } },
      { signup: { from: "2026-02-30", to: "2026-03-01" } }, { signup: { from: "2026-10-01" } }, { signup: { from: "2026-10-01", to: "2026-10-02", x: 1 } },
      { vsat_registered: "yes" }, { exam_given: 1 }, { payment: "free" }, { payment: ["paid"] }, { consent_given: null },
    ]) expect(ok(v), JSON.stringify(v)).toBe(false);
    expect(ok(["utm_source"])).toBe(false);
    expect(ok("x")).toBe(false);
    expect(ok(null)).toBe(false);
  });
  it("invalid: more than 4096 bytes in total", () => {
    const big = { utm_source: Array.from({ length: 20 }, (_, i) => "z".repeat(95) + i), utm_campaign: Array.from({ length: 20 }, (_, i) => "w".repeat(95) + i), state: ["x".repeat(90)] };
    expect(ok(big)).toBe(false);
  });
});

describe("bodies and query", () => {
  it("create: name 1–80 after trim, no control characters, conditions required", () => {
    expect(createBody.safeParse({ name: "  Paid applicants  ", conditions: {} }).data).toEqual({ name: "Paid applicants", conditions: {} });
    for (const name of ["", "   ", "n".repeat(81), "bad\nname"]) expect(createBody.safeParse({ name, conditions: {} }).success, name).toBe(false);
    expect(createBody.safeParse({ name: "x" }).success).toBe(false);
    expect(createBody.safeParse({ name: "x", conditions: {}, owner_id: "u" }).success).toBe(false);
  });
  it("update: at least one of name / conditions; nothing else", () => {
    expect(updateBody.safeParse({ name: "New" }).success).toBe(true);
    expect(updateBody.safeParse({ conditions: { payment: "paid" } }).success).toBe(true);
    expect(updateBody.safeParse({}).success).toBe(false);
    expect(updateBody.safeParse({ name: "x", deleted_at: null }).success).toBe(false);
  });
  it("preview: only conditions", () => {
    expect(previewBody.safeParse({ conditions: { consent_given: true } }).success).toBe(true);
    expect(previewBody.safeParse({ conditions: {}, limit: 1000 }).success).toBe(false);
  });
  it("list query: search ≤ 100, page/size limits, nothing else", () => {
    const u = (qs: string) => new URL(`https://x.example/api/admin/comm/lists?${qs}`);
    expect(parseQuery(u("search=paid&page=2&size=25"), listsQuery)).toEqual({ ok: true, data: { search: "paid", page: 2, size: 25 } });
    for (const qs of ["size=101", "page=0", "owner=me", `search=${"s".repeat(101)}`]) expect(parseQuery(u(qs), listsQuery).ok, qs).toBe(false);
  });
});
