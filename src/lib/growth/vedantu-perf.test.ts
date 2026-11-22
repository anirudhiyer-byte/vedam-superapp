import { describe, expect, it } from "vitest";
import {
  anyPerfFilter, drillCsv, drillFileName, drillParams, filterDrill, filterPerfRows, fmtPct, fmtShortInr, nextDrillSort, NO_PERF_FILTER,
  perfKpis, perfOptions, rangeError, sortDrill,
} from "./vedantu-perf";
import type { VdRow } from "./vedantu";

const row = (o: Partial<VdRow> & { id: string }): VdRow => ({
  channel: "Chan A", live_link: "https://youtu.be/a", utm_link: "https://x.test/a?utm_source=yt", live_date: "2091-01-10",
  campaign_id: "c1", campaign: "VSAT-10", expected_views: null, actual_views: null, video_spend: 0, cpa: 0, notes: null, extra: {},
  created_at: "", updated_at: "", deleted_at: null, utm_key: null,
  leads: 0, payments: 0, enrollments: 0, leads_all: 0, payments_all: 0, enrollments_all: 0, ...o,
});

describe("filters (CRM: From / To on Live Date, exact Campaign and Channel)", () => {
  const rows = [
    row({ id: "1", live_date: "2091-01-10", campaign: "VSAT-2", channel: "A" }),
    row({ id: "2", live_date: "2091-02-10", campaign: "VSAT-12", channel: "B" }),
    row({ id: "3", live_date: "2091-03-10", campaign: null, channel: "A" }),
  ];
  const ids = (f: Partial<typeof NO_PERF_FILTER>) => filterPerfRows(rows, { ...NO_PERF_FILTER, ...f }).map((r) => r.id);
  it("From and To are inclusive", () => {
    expect(ids({ from: "2091-02-10" })).toEqual(["2", "3"]);
    expect(ids({ to: "2091-02-10" })).toEqual(["1", "2"]);
    expect(ids({ from: "2091-02-01", to: "2091-02-28" })).toEqual(["2"]);
  });
  it("Campaign and Channel narrow further", () => {
    expect(ids({ campaign: "VSAT-12" })).toEqual(["2"]);
    expect(ids({ channel: "A" })).toEqual(["1", "3"]);
    expect(ids({ channel: "A", campaign: "VSAT-2" })).toEqual(["1"]);
  });
  it("From after To is reported", () => {
    expect(rangeError({ ...NO_PERF_FILTER, from: "2091-03-01", to: "2091-01-01" })).toMatch(/From/);
    expect(rangeError({ ...NO_PERF_FILTER, from: "2091-01-01", to: "2091-01-01" })).toBeNull();
    expect(anyPerfFilter(NO_PERF_FILTER)).toBe(false);
    expect(anyPerfFilter({ ...NO_PERF_FILTER, to: "2091-01-01" })).toBe(true);
  });
  it("dropdowns in natural order (VSAT-2 before VSAT-12)", () => {
    expect(perfOptions(rows, "campaign")).toEqual(["VSAT-2", "VSAT-12"]);
    expect(perfOptions(rows, "channel")).toEqual(["A", "B"]);
  });
});

describe("cards = totals of the Listing rows", () => {
  const rows = [
    row({ id: "1", live_link: "https://y/v1", utm_link: "https://u/1", actual_views: 1000, video_spend: 10000, cpa: 100,
      leads: 5, leads_all: 10, payments: 2, payments_all: 4, enrollments: 0, enrollments_all: 1 }),
    row({ id: "2", live_link: "https://y/v1", utm_link: "https://u/2", actual_views: 500, video_spend: 5000,
      leads: 3, leads_all: 6, payments: 1, payments_all: 1, enrollments_all: 0 }),
    row({ id: "3", live_link: null, utm_link: "https://u/2 " }),
  ];
  it("unique videos and UTMs, views, spend, counts", () => {
    const k = perfKpis(rows);
    expect(k.uniqueVideos).toBe(1);
    expect(k.uniqueUtms).toBe(2);
    expect(k.totalViews).toBe(1500);
    expect(k.totalSpend).toBe(10000 + 100 * 4 + 5000);
    expect([k.leadsWin, k.leadsAll, k.payWin, k.payAll, k.enrollments]).toEqual([8, 16, 3, 5, 1]);
  });
  it("CPL, CPP and L2P use the all-time counts", () => {
    const k = perfKpis(rows);
    expect(k.cpl).toBeCloseTo(15400 / 16);
    expect(k.cpp).toBeCloseTo(15400 / 5);
    expect(k.l2p).toBeCloseTo(31.25);
  });
  it("no rows → zeros, no division by zero", () => {
    expect(perfKpis([])).toMatchObject({ uniqueVideos: 0, totalSpend: 0, cpl: 0, cpp: 0, l2p: 0 });
  });
});

describe("formats (CRM card amounts)", () => {
  it("₹ short form", () => {
    expect(fmtShortInr(0)).toBe("₹0");
    expect(fmtShortInr(950)).toBe("₹950");
    expect(fmtShortInr(4200)).toBe("₹4.2K");
    expect(fmtShortInr(1494500)).toBe("₹14.9L");
    expect(fmtShortInr(25000000)).toBe("₹2.50Cr");
    expect(fmtPct(19.8876)).toBe("19.89%");
  });
});

describe("drill request", () => {
  it("sends only the filters that are set", () => {
    expect(drillParams("leads", "in_window", NO_PERF_FILTER)).toEqual({ type: "leads", scope: "in_window" });
    expect(drillParams("payments", "all_time", { from: "2091-01-01", to: "2091-02-01", campaign: "VSAT-2", channel: "A" }))
      .toEqual({ type: "payments", scope: "all_time", start: "2091-01-01", end: "2091-02-01", campaign: "VSAT-2", channel: "A" });
  });
});

describe("drill table", () => {
  const rows = [
    { user_id: "98550", registered_name: "Zed", registered_email: "zed@example.invalid", lead_stage: "lead" },
    { user_id: "100168", registered_name: "amy", registered_email: "amy@example.invalid", lead_stage: null },
    { user_id: "7", registered_name: "Bob", registered_email: "bob@x.invalid", lead_stage: "verified" },
  ];
  it("search looks in every column; column filters narrow further (any case)", () => {
    expect(filterDrill(rows, "EXAMPLE", {}).map((r) => r.user_id)).toEqual(["98550", "100168"]);
    expect(filterDrill(rows, "example", { registered_name: "AM" }).map((r) => r.user_id)).toEqual(["100168"]);
    expect(filterDrill(rows, "", { lead_stage: "" })).toHaveLength(3);
    expect(filterDrill(rows, "nobody", {})).toHaveLength(0);
  });
  it("sort: a new column starts descending, then flips; numbers compare as numbers; empties last", () => {
    let s = nextDrillSort(null, "user_id");
    expect(s).toEqual({ col: "user_id", dir: "desc" });
    expect(sortDrill(rows, s).map((r) => r.user_id)).toEqual(["100168", "98550", "7"]);
    s = nextDrillSort(s, "user_id");
    expect(sortDrill(rows, s).map((r) => r.user_id)).toEqual(["7", "98550", "100168"]);
    expect(sortDrill(rows, { col: "lead_stage", dir: "asc" }).map((r) => r.user_id)).toEqual(["98550", "7", "100168"]);
    expect(nextDrillSort(s, "registered_name")).toEqual({ col: "registered_name", dir: "desc" });
  });
  it("CSV is formula-safe and keeps the column order", () => {
    const csv = drillCsv(["a", "b"], [{ a: "=SUM(1)", b: 'x, "y"' }, { a: null, b: 5 }]);
    expect(csv.split("\r\n")).toEqual(["a,b", `'=SUM(1),"x, ""y"""`, ",5"]);
    expect(drillFileName("Leads (In Window)", 170)).toBe("vedantu-leads-in-window-170-rows.csv");
  });
});
