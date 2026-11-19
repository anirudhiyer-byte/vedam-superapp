import { describe, expect, it } from "vitest";
import {
  buildCohortPayload, buildMatrix, checkRange, cohortError, conversion, dayList, fmtDay, fmtFull, fmtShort, heatAlpha,
  MAX_RANGE_DAYS, summarySource, type CohortReport,
} from "./cohort";

// Growth → Overview → Payment Cohort: the pure parts. Numbers come from growth_cohort_report (migration 0117).

const base = (over: Partial<CohortReport> = {}): CohortReport => ({
  from: "2026-07-03", to: "2026-07-05", today: "2026-11-19", locked: false, source: "custom", campaign: null,
  leads: [], cells: [], before: [], before_days: 0, after: [], after_days: 0, unknown: [], ...over,
});

describe("dayList", () => {
  it("lists every IST day from → to, both included", () => {
    expect(dayList("2026-07-03", "2026-07-05")).toEqual(["2026-07-03", "2026-07-04", "2026-07-05"]);
    expect(dayList("2026-11-19", "2026-11-19")).toEqual(["2026-11-19"]);
  });
  it("crosses month and year ends (and 29 Feb)", () => {
    expect(dayList("2026-12-30", "2027-01-02")).toEqual(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
    expect(dayList("2028-02-28", "2028-03-01")).toEqual(["2028-02-28", "2028-02-29", "2028-03-01"]);
  });
  it("bad, reversed or too long ranges give no days (never a huge loop)", () => {
    expect(dayList("abc", "2026-07-05")).toEqual([]);
    expect(dayList("2026-02-30", "2026-03-01")).toEqual([]);
    expect(dayList("2026-07-05", "2026-07-03")).toEqual([]);
    expect(dayList("", "")).toEqual([]);
    expect(dayList("2026-01-01", "2026-12-31")).toEqual([]);
    expect(dayList("2026-01-01", "2026-04-30")).toHaveLength(MAX_RANGE_DAYS);
  });
});

describe("date labels (no Date timezone shift)", () => {
  it("CRM formats", () => {
    expect(fmtFull("2026-11-19")).toBe("19 Nov 2026");
    expect(fmtShort("2026-11-19")).toBe("19 Nov");
    expect(fmtDay("2026-07-03")).toBe("3");
  });
  it("bad input shows a dash", () => {
    expect(fmtFull("abc")).toBe("—");
    expect(fmtShort("")).toBe("—");
    expect(fmtDay("2026-13-01")).toBe("—");
  });
});

describe("heatAlpha (CRM: 0.12 + intensity × 0.55)", () => {
  it("scales with the biggest cell", () => {
    expect(heatAlpha(10, 10)).toBeCloseTo(0.67);
    expect(heatAlpha(5, 10)).toBeCloseTo(0.395);
    expect(heatAlpha(1, 10)).toBeCloseTo(0.175);
  });
  it("empty / bad / bigger than max", () => {
    expect(heatAlpha(0, 10)).toBe(0);
    expect(heatAlpha(3, 0)).toBe(0);
    expect(heatAlpha(-2, 10)).toBe(0);
    expect(heatAlpha(Number.NaN, 10)).toBe(0);
    expect(heatAlpha(20, 10)).toBeCloseTo(0.67);
  });
});

describe("conversion (Paid ÷ Leads × 100, 1 decimal)", () => {
  it("normal", () => {
    expect(conversion(41, 7347)).toBe("0.6");
    expect(conversion(79, 1973)).toBe("4.0");
    expect(conversion(1, 3)).toBe("33.3");
  });
  it("0 leads → 0.0 (no division by zero); bad numbers → 0.0", () => {
    expect(conversion(5, 0)).toBe("0.0");
    expect(conversion(0, 0)).toBe("0.0");
    expect(conversion(Number.NaN, 10)).toBe("0.0");
    expect(conversion(-3, 10)).toBe("0.0");
  });
  it("more paid than leads is shown as it is (Before rows count too)", () => {
    expect(conversion(6, 4)).toBe("150.0");
  });
});

describe("buildMatrix", () => {
  const r = base({
    leads: [{ d: "2026-07-03", n: 10 }, { d: "2026-07-05", n: 4 }],
    cells: [{ l: "2026-07-03", p: "2026-07-03", n: 2 }, { l: "2026-07-03", p: "2026-07-05", n: 1 }, { l: "2026-07-05", p: "2026-07-05", n: 3 }],
    before: [{ p: "2026-07-04", n: 1 }, { p: "2026-07-05", n: 2 }], before_days: 2,
    unknown: [{ p: "2026-07-04", n: 1 }],
    after: [{ p: "2026-07-05", n: 1 }], after_days: 1,
  });
  const m = buildMatrix(r);

  it("rows in CRM order: Before, Unknown, one per day, then After", () => {
    expect(m.rows.map((x) => x.kind)).toEqual(["before", "unknown", "day", "day", "day", "after"]);
    expect(m.rows[0]).toMatchObject({ label: "Before 3 Jul", sub: "2 earlier lead days", leads: null });
    expect(m.rows[1]).toMatchObject({ label: "Unknown lead date", leads: null });
    expect(m.rows[2]).toMatchObject({ label: "3 Jul", title: "3 Jul 2026", leads: 10 });
    expect(m.rows[3]).toMatchObject({ label: "4 Jul", leads: 0, total: 0 });
    expect(m.rows[5]).toMatchObject({ label: "After 5 Jul", sub: "1 later lead day", leads: null });
  });
  it("cells land on lead day × pay day", () => {
    expect(m.days).toEqual(["2026-07-03", "2026-07-04", "2026-07-05"]);
    expect(m.rows[2].cells).toEqual([2, 0, 1]);
    expect(m.rows[4].cells).toEqual([0, 0, 3]);
    expect(m.rows[0].cells).toEqual([0, 1, 2]);
  });
  it("totals reconcile: every row + Before + Unknown + After = column totals = grand total", () => {
    for (const row of m.rows) expect(row.cells.reduce((a, b) => a + b, 0)).toBe(row.total);
    const sumCols = m.days.map((_, j) => m.rows.reduce((a, row) => a + row.cells[j], 0));
    expect(sumCols).toEqual(m.colTotals);
    expect(m.colTotals).toEqual([2, 2, 7]);
    expect(m.grand).toBe(11);
    expect(m.rows.reduce((a, row) => a + row.total, 0)).toBe(m.grand);
    expect(m.totalLeads).toBe(14);
  });
  it("maxCell covers every bucket (CRM)", () => {
    expect(m.maxCell).toBe(3);
  });
  it("Before / Unknown / After rows only when they have payments", () => {
    const x = buildMatrix(base({ cells: [{ l: "2026-07-04", p: "2026-07-04", n: 1 }] }));
    expect(x.rows.map((y) => y.kind)).toEqual(["day", "day", "day"]);
    expect(buildMatrix(base({ before: [{ p: "2026-07-03", n: 1 }], before_days: 1 })).rows[0].sub).toBe("1 earlier lead day");
  });
  it("empty / null report → no rows, all zero", () => {
    expect(buildMatrix(null)).toMatchObject({ days: [], rows: [], grand: 0, totalLeads: 0, maxCell: 0 });
    expect(buildMatrix(base()).grand).toBe(0);
  });
  it("bad numbers and days outside the range never reach the screen", () => {
    const x = buildMatrix(base({
      leads: [{ d: "2026-07-03", n: -5 }, { d: "2026-07-09", n: 7 }, { d: "2026-07-04", n: Number.NaN }],
      cells: [{ l: "2026-07-03", p: "2026-07-03", n: "2" as unknown as number }, { l: "2026-07-03", p: "2026-08-01", n: 4 }, { l: "x", p: "2026-07-03", n: 1 }],
      before: [{ p: "2026-07-03", n: -1 }],
    }));
    expect(x.totalLeads).toBe(0);
    expect(x.rows.find((y) => y.label === "3 Jul")?.cells).toEqual([2, 0, 0]);
    expect(x.grand).toBe(2);
    expect(x.rows.some((y) => y.kind === "before")).toBe(false);
  });
});

describe("summarySource", () => {
  it("campaign / custom / default, like the CRM summary bar", () => {
    expect(summarySource(base({ locked: true, source: "campaign", campaign: { id: "x", name: "VSAT-14" } }))).toBe("VSAT-14 (campaign window)");
    expect(summarySource(base())).toBe("custom range");
    expect(summarySource(base({ source: "default" }))).toBe("last 30 days");
    expect(summarySource(null)).toBe("");
  });
});

describe("buildCohortPayload (campaign OR dates, never both, never bad values)", () => {
  const id = "9ceb1cf1-2731-45ff-9d7c-f1ce73058cee";
  it("a campaign wins and dates are not sent with it", () => {
    expect(buildCohortPayload({ campaignId: id, from: "2026-07-01", to: "2026-07-02" })).toEqual({ campaign_id: id });
    expect(buildCohortPayload({ campaignId: ` ${id.toUpperCase()} `, from: "", to: "" })).toEqual({ campaign_id: id });
  });
  it("valid dates are sent when there is no campaign", () => {
    expect(buildCohortPayload({ campaignId: "", from: "2026-07-01", to: "2026-07-02" })).toEqual({ from: "2026-07-01", to: "2026-07-02" });
  });
  it("bad id / bad or half dates → {} (the database opens its last 30 days)", () => {
    expect(buildCohortPayload({ campaignId: "not-a-uuid", from: "", to: "" })).toEqual({});
    expect(buildCohortPayload({ campaignId: "", from: "2026-02-30", to: "2026-03-01" })).toEqual({});
    expect(buildCohortPayload({ campaignId: "", from: "2026-07-01", to: "" })).toEqual({});
    expect(buildCohortPayload({ campaignId: "'; drop table x; --", from: "abc", to: "1' or '1'='1" })).toEqual({});
  });
});

describe("checkRange (screen check before asking the database)", () => {
  it("ok inside 120 days", () => {
    expect(checkRange("2026-07-01", "2026-07-01")).toEqual({ ok: true });
    expect(checkRange("2026-01-01", "2026-04-30")).toEqual({ ok: true });
  });
  it("refuses bad, reversed and too long ranges with a plain sentence", () => {
    expect(checkRange("abc", "2026-07-01")).toMatchObject({ ok: false });
    expect(checkRange("2026-07-05", "2026-07-01")).toMatchObject({ ok: false, error: expect.stringMatching(/From date/) });
    expect(checkRange("2026-01-01", "2026-05-01")).toMatchObject({ ok: false, error: expect.stringMatching(/120 days/) });
  });
});

describe("cohortError", () => {
  it("database codes become plain sentences", () => {
    expect(cohortError("FORBIDDEN")).toBe("Only admins can open the Payment Cohort.");
    expect(cohortError("BAD_VALUE: range")).toMatch(/120 days/);
    expect(cohortError("BAD_VALUE: to")).toMatch(/To date/);
    expect(cohortError("NOT_FOUND")).toMatch(/campaign/i);
    expect(cohortError("BAD_VALUE: campaign_id")).toMatch(/campaign/i);
    expect(cohortError("NOT_SIGNED_IN")).toMatch(/sign in/i);
  });
  it("a campaign window over 120 days says so (its dates are locked, so 'pick a range' would not help)", () => {
    expect(cohortError("BAD_VALUE: range", { campaign: true })).toMatch(/campaign/i);
    expect(cohortError("BAD_VALUE: range", { campaign: true })).toMatch(/120 days/);
    expect(cohortError("FORBIDDEN", { campaign: true })).toBe("Only admins can open the Payment Cohort.");
  });
  it("unknown database text is never shown", () => {
    expect(cohortError('relation "public.vsat_payments" does not exist')).toBe("Something went wrong. Please try again.");
    expect(cohortError(undefined)).toBe("Something went wrong. Please try again.");
  });
});
