import { describe, expect, it } from "vitest";
import {
  buildReportPayload, campaignOption, daysBetween, gapNote, metrics, reportRows, toSplit, vcampError, fmtIN, ZERO_SPLIT,
} from "./vcamp";

const UUID = "1cb66bd2-1cf8-4393-9030-5b3af6383a9b";

describe("buildReportPayload", () => {
  it("no campaign → empty object (the database picks the default)", () => {
    expect(buildReportPayload("")).toEqual({});
    expect(buildReportPayload("   ")).toEqual({});
  });
  it("a uuid is sent as campaign_id", () => {
    expect(buildReportPayload(UUID)).toEqual({ campaign_id: UUID });
    expect(buildReportPayload(` ${UUID.toUpperCase()} `)).toEqual({ campaign_id: UUID });
  });
  it.each([["not-a-real-id"], ["1234"], ["'; drop table x; --"], [`${UUID}x`]])("a bad id (%s) is not sent", (bad) => {
    expect(buildReportPayload(bad)).toEqual({});
  });
});

describe("daysBetween", () => {
  it("counts calendar days between two ISO dates", () => {
    expect(daysBetween("2026-11-19", "2026-11-30")).toBe(11);
    expect(daysBetween("2026-11-19", "2026-11-19")).toBe(0);
    expect(daysBetween("2026-11-30", "2026-11-19")).toBe(-11);
    expect(daysBetween("2026-02-28", "2026-03-01")).toBe(1);
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
  });
  it("invalid dates → 0", () => {
    expect(daysBetween("", "2026-01-01")).toBe(0);
    expect(daysBetween("2026-13-01", "2026-01-01")).toBe(0);
  });
});

describe("metrics (CRM: remaining, % of target, days to go)", () => {
  it("running campaign", () => {
    expect(metrics({ target: 160, achieved: 88, end: "2026-11-30", today: "2026-11-19" })).toEqual({
      remaining: 72, pct: 55, daysToGo: 11, over: false,
    });
  });
  it("last day of the campaign: 0 days to go, not over", () => {
    expect(metrics({ target: 10, achieved: 1, end: "2026-11-19", today: "2026-11-19" })).toMatchObject({ daysToGo: 0, over: false });
  });
  it("ended campaign: 0 days, over", () => {
    expect(metrics({ target: 160, achieved: 88, end: "2026-07-24", today: "2026-11-19" })).toMatchObject({ daysToGo: 0, over: true });
  });
  it("target 0 → 0% and 0 remaining (no divide by zero)", () => {
    expect(metrics({ target: 0, achieved: 98, end: "2026-09-30", today: "2026-11-19" })).toMatchObject({ pct: 0, remaining: 0 });
  });
  it("achievement above target → remaining 0, % above 100", () => {
    expect(metrics({ target: 50, achieved: 75, end: "2026-12-01", today: "2026-11-19" })).toMatchObject({ remaining: 0, pct: 150 });
  });
  it("rounds % like the CRM (Math.round)", () => {
    expect(metrics({ target: 3, achieved: 1, end: "2026-12-01", today: "2026-11-19" }).pct).toBe(33);
    expect(metrics({ target: 8, achieved: 5, end: "2026-12-01", today: "2026-11-19" }).pct).toBe(63);
  });
  it("a campaign without an end date → 0 days, not over", () => {
    expect(metrics({ target: 10, achieved: 2, end: null, today: "2026-11-19" })).toMatchObject({ daysToGo: 0, over: false, remaining: 8, pct: 20 });
  });
  it("bad numbers are treated as 0", () => {
    expect(metrics({ target: Number.NaN, achieved: -5, end: "2026-12-01", today: "2026-11-19" })).toMatchObject({ pct: 0, remaining: 0 });
  });
});

describe("toSplit", () => {
  it("reads a database split", () => {
    expect(toSplit({ total: 5, ggn: 2, pune: 1, other: 2 })).toEqual({ total: 5, ggn: 2, pune: 1, other: 2 });
  });
  it("missing / wrong values → 0 (never NaN on screen)", () => {
    expect(toSplit(null)).toEqual(ZERO_SPLIT);
    expect(toSplit({ total: "x", ggn: -1 })).toEqual(ZERO_SPLIT);
  });
});

describe("reportRows (the 7 CRM rows, in CRM order)", () => {
  const rows = reportRows(true);
  it("labels and order", () => {
    expect(rows.map((r) => r.label)).toEqual([
      "Achievement (paid)", "Today's payments", "Yesterday's payments", "Last 3 days payments",
      "Today's leads", "Yesterday's leads", "Total leads (campaign window)",
    ]);
    expect(rows.map((r) => r.key)).toEqual(["achievement", "today_pay", "yday_pay", "last3_pay", "today_leads", "yday_leads", "total_leads"]);
  });
  it("bold / accent / campus-gap flags like the CRM", () => {
    expect(rows.filter((r) => r.bold).map((r) => r.key)).toEqual(["achievement", "total_leads"]);
    expect(rows.filter((r) => r.accent).map((r) => r.key)).toEqual(["achievement"]);
    expect(rows.filter((r) => r.gap).map((r) => r.key)).toEqual(["today_leads", "yday_leads", "total_leads"]);
  });
  it("last-3-days label says when the window is outside the campaign", () => {
    expect(reportRows(false)[3].label).toBe("Last 3 days payments — outside campaign");
  });
});

describe("gapNote", () => {
  it("shows only for lead rows with campus-less leads", () => {
    expect(gapNote({ total: 1799, ggn: 750, pune: 663, other: 386 }, true)).toBe("386 without campus preference");
    expect(gapNote({ total: 10, ggn: 5, pune: 5, other: 0 }, true)).toBeNull();
    expect(gapNote({ total: 10, ggn: 5, pune: 4, other: 1 }, false)).toBeNull();
  });
  it("uses Indian grouping", () => {
    expect(gapNote({ total: 200000, ggn: 0, pune: 0, other: 123456 }, true)).toBe("1,23,456 without campus preference");
  });
});

describe("fmtIN / campaignOption", () => {
  it("formats like toLocaleString('en-IN')", () => {
    expect(fmtIN(1973)).toBe("1,973");
    expect(fmtIN(1250000)).toBe("12,50,000");
    expect(fmtIN(Number.NaN)).toBe("0");
  });
  it("option text is the CRM's `Name (start → end)`", () => {
    expect(campaignOption({ name: "VSAT-15", campaign_start: "2026-07-14", campaign_end: "2026-07-24" })).toBe("VSAT-15 (2026-07-14 → 2026-07-24)");
  });
  it("missing dates show a dash instead of null", () => {
    expect(campaignOption({ name: "Old", campaign_start: null, campaign_end: null })).toBe("Old (— → —)");
  });
});

describe("vcampError", () => {
  it("known codes become plain sentences", () => {
    expect(vcampError("FORBIDDEN")).toBe("Only admins can open the VSAT Campaign Report.");
    expect(vcampError("NOT_FOUND")).toMatch(/not found/i);
  });
  it("unknown database text is never shown", () => {
    expect(vcampError('relation "public.lead_manager" does not exist')).toBe("Something went wrong. Please try again.");
    expect(vcampError(null)).toBe("Something went wrong. Please try again.");
  });
});
