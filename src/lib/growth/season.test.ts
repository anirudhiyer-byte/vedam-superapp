import { describe, expect, it } from "vitest";
import {
  academicYearStart, validateRange, parseSearch, nextSort, pageCount, clampPage, toCsv, seasonError,
  buildCountsPayload, buildDrillPayload, columnsFor, DRILL_PAGE_SIZE, DRILL_PAGE_SIZE_LEADS, EXPORT_MAX_ROWS, type DrillKind,
} from "./season";

describe("academicYearStart", () => {
  it("before 1 Nov → 1 Nov of the previous year", () => {
    expect(academicYearStart("2026-10-31")).toBe("2025-11-01");
    expect(academicYearStart("2026-01-01")).toBe("2025-11-01");
  });
  it("on or after 1 Nov → 1 Nov of this year", () => {
    expect(academicYearStart("2026-11-01")).toBe("2026-11-01");
    expect(academicYearStart("2026-12-31")).toBe("2026-11-01");
  });
});

describe("validateRange", () => {
  it("accepts equal and ordered dates", () => {
    expect(validateRange("2026-01-01", "2026-01-01")).toEqual({ ok: true });
    expect(validateRange("2026-01-01", "2026-02-01")).toEqual({ ok: true });
  });
  it("From after To gives a clear message (the CRM silently showed 0)", () => {
    expect(validateRange("2026-02-01", "2026-01-01")).toEqual({ ok: false, error: "The From date must be on or before the To date." });
  });
  it.each([["", "2026-01-01"], ["2026-01-01", ""], ["2026-13-01", "2026-12-01"], ["2026-02-30", "2026-03-01"], ["abc", "2026-01-01"], ["2026-1-1", "2026-01-02"]])(
    "refuses a missing or invalid date (%s, %s)", (a, b) => {
      const r = validateRange(a, b);
      expect(r.ok).toBe(false);
    });
});

describe("parseSearch", () => {
  it("empty / blank → nothing", () => {
    expect(parseSearch("")).toEqual({ include: [], exclude: [] });
    expect(parseSearch("  , ,  ")).toEqual({ include: [], exclude: [] });
  });
  it("comma separates many terms, trimmed", () => {
    expect(parseSearch(" pune , delhi ")).toEqual({ include: ["pune", "delhi"], exclude: [] });
  });
  it("! excludes", () => {
    expect(parseSearch("pune, !test, ! spam")).toEqual({ include: ["pune"], exclude: ["test", "spam"] });
  });
  it("a lone ! is ignored", () => {
    expect(parseSearch("!")).toEqual({ include: [], exclude: [] });
  });
  it("caps at 10 terms of 100 characters", () => {
    const many = Array.from({ length: 15 }, (_, i) => `t${i}`).join(",");
    expect(parseSearch(many).include).toHaveLength(10);
    expect(parseSearch("x".repeat(500)).include[0]).toHaveLength(100);
  });
  it("keeps SQL / HTML looking text as plain text (the database never concatenates it)", () => {
    expect(parseSearch("'; drop table x; --").include).toEqual(["'; drop table x; --"]);
    expect(parseSearch("<script>alert(1)</script>").include).toEqual(["<script>alert(1)</script>"]);
  });
});

describe("nextSort", () => {
  it("cycles desc → asc → default for one column", () => {
    const a = nextSort(null, "name");
    expect(a).toEqual({ col: "name", dir: "desc" });
    const b = nextSort(a, "name");
    expect(b).toEqual({ col: "name", dir: "asc" });
    expect(nextSort(b, "name")).toBeNull();
  });
  it("another column starts at desc", () => {
    expect(nextSort({ col: "name", dir: "asc" }, "city")).toEqual({ col: "city", dir: "desc" });
  });
});

describe("paging", () => {
  it("pageCount is at least 1", () => {
    expect(pageCount(0, 50)).toBe(1);
    expect(pageCount(1, 50)).toBe(1);
    expect(pageCount(50, 50)).toBe(1);
    expect(pageCount(51, 50)).toBe(2);
  });
  it("clampPage keeps 1..last", () => {
    expect(clampPage(0, 120, 50)).toBe(1);
    expect(clampPage(-4, 120, 50)).toBe(1);
    expect(clampPage(99, 120, 50)).toBe(3);
    expect(clampPage(2, 120, 50)).toBe(2);
    expect(clampPage(Number.NaN, 120, 50)).toBe(1);
  });
});

describe("toCsv", () => {
  const cols = [{ key: "a", label: "Name" }, { key: "b", label: "City" }];
  it("header + rows, quotes commas, quotes and new lines", () => {
    const csv = toCsv(cols, [{ a: 'Asha "A", K', b: "Pune\nWest" }, { a: "Ravi", b: null }]);
    expect(csv).toBe('Name,City\r\n"Asha ""A"", K","Pune\nWest"\r\nRavi,');
  });
  it("neutralises spreadsheet formulas (CSV injection)", () => {
    const csv = toCsv(cols, [{ a: "=HYPERLINK(\"http://x\")", b: "+1" }, { a: "-2", b: "@SUM(A1)" }, { a: "\tx", b: "ok" }]);
    const lines = csv.split("\r\n");
    expect(lines[1].startsWith("\"'=")).toBe(true);
    expect(lines[1]).toContain("'+1");
    expect(lines[2]).toContain("'-2");
    expect(lines[2]).toContain("'@SUM");
    expect(lines[3]).toContain("'\tx");
  });
  it("empty rows → header only", () => {
    expect(toCsv(cols, [])).toBe("Name,City");
  });
});

describe("payload builders", () => {
  it("counts: dates only, or a campaign", () => {
    expect(buildCountsPayload({ from: "2026-01-01", to: "2026-02-01", campaignId: "" })).toEqual({ from: "2026-01-01", to: "2026-02-01" });
    expect(buildCountsPayload({ from: "2026-01-01", to: "2026-02-01", campaignId: "c-1" })).toEqual({ campaign_id: "c-1" });
  });
  it("drill: sends only allowed keys, drops empty filters, clamps page size and page", () => {
    const p = buildDrillPayload({
      kind: "leads", from: "2026-01-01", to: "2026-02-01", campaignId: "", search: " pune , !test ",
      filters: { city: " Pune ", state: "", utm: "  " }, sort: { col: "created", dir: "desc" }, page: 0, pageSize: 9999,
    });
    expect(p).toEqual({
      kind: "leads", from: "2026-01-01", to: "2026-02-01", search: "pune , !test",
      filters: { city: "Pune" }, sort: { col: "created", dir: "desc" }, page: 1, page_size: DRILL_PAGE_SIZE,
    });
  });
  it("drill: campaign replaces the dates; export flag is explicit", () => {
    const p = buildDrillPayload({ kind: "paid", from: "x", to: "y", campaignId: "c-1", search: "", filters: {}, sort: null, page: 2, pageSize: 25, exportAll: true });
    expect(p).toEqual({ kind: "paid", campaign_id: "c-1", page: 2, page_size: 25, export: true });
  });
  it("drill: the Leads list may ask for 100 per page (CRM size), never more than the database allows", () => {
    const base = { kind: "leads" as const, from: "2026-01-01", to: "2026-02-01", campaignId: "", search: "", filters: {}, sort: null, page: 1 };
    expect(buildDrillPayload({ ...base, pageSize: 100, maxPageSize: DRILL_PAGE_SIZE_LEADS }).page_size).toBe(100);
    expect(buildDrillPayload({ ...base, pageSize: 9999, maxPageSize: DRILL_PAGE_SIZE_LEADS }).page_size).toBe(100);
    expect(buildDrillPayload({ ...base, pageSize: 9999, maxPageSize: 100000 }).page_size).toBe(100);
    expect(buildDrillPayload({ ...base, pageSize: 100 }).page_size).toBe(DRILL_PAGE_SIZE);
  });
  it("EXPORT_MAX_ROWS is a sane cap", () => {
    expect(EXPORT_MAX_ROWS).toBeGreaterThanOrEqual(1000);
    expect(EXPORT_MAX_ROWS).toBeLessThanOrEqual(20000);
  });
});

describe("columns", () => {
  it.each<DrillKind>(["leads", "paid", "enrolled"])("%s: unique keys, every column has a label", (k) => {
    const cols = columnsFor(k);
    expect(cols.length).toBeGreaterThan(10);
    expect(new Set(cols.map((c) => c.key)).size).toBe(cols.length);
    for (const c of cols) { expect(c.label.length).toBeGreaterThan(0); expect(c.key).toMatch(/^[a-z0-9_]+$/); }
  });
  it("Paid and Enrolments show the same application columns; Leads are a different set", () => {
    expect(columnsFor("paid")).toEqual(columnsFor("enrolled"));
    expect(columnsFor("leads")).not.toEqual(columnsFor("paid"));
  });
});

describe("seasonError", () => {
  it("says who may open the page", () => {
    expect(seasonError("FORBIDDEN")).toBe("Only admins can open the Season Dashboard.");
    expect(seasonError("NOT_SIGNED_IN")).toBe("Your session ended. Sign in again.");
  });
  it("range and campaign codes become sentences", () => {
    expect(seasonError("BAD_VALUE: to")).toBe("The To date must be on or after the From date.");
    expect(seasonError("NOT_FOUND")).toBe("It no longer exists. Reload the page.");
  });
  it("never shows raw database text", () => {
    const t = seasonError('relation "public.lead_manager" does not exist');
    expect(t).not.toMatch(/lead_manager|relation/);
    expect(t.length).toBeGreaterThan(5);
  });
  it("empty → generic sentence", () => {
    expect(seasonError(null).length).toBeGreaterThan(5);
  });
});
