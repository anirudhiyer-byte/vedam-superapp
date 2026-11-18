import { describe, expect, it } from "vitest";
import {
  adCards, bestV2l, countTicks, csvToRows, errorText, fillWeeks, fmtCompact, groupTotals, highestL2p, importErrors, inRange, inflCards,
  labelIndexes, lowestCpp, parseAmount, matchesTerms, metrics, mondayOf, splitTerms, totals, youTubeId,
  type AdRow, type CustomColumn, type PerfRow, type PostRow,
} from "./marketing";

const perf = (o: Partial<PerfRow>): PerfRow => ({
  id: "r", utm_key: null, campaign_id: null, campaign: null, cost: 0, platform: "Meta", live_date: null, label: "x",
  influencer_id: null, influencer: null, views: null, status: "Enabled", live_link: null, utm_link: null, leads: 0, payments: 0, enrollments: 0, ...o,
});
const ad = (o: Partial<AdRow>): AdRow => ({
  id: "a", serial_no: 1, ad_name: "x", platform: "Meta", campaign_id: "c9", campaign: "VSAT-9", campaign_status: "Enabled", live_date: null,
  spend: 0, utm_link: null, notes: null, extra: {}, updated_at: "", utm_key: null, leads: null, payments: null, enrollments: null,
  leads_all: 0, payments_all: 0, enrollments_all: 0, ...o,
});

describe("search", () => {
  it("splits on commas and ORs the terms", () => {
    expect(splitTerms(" Meta, google ,, ")).toEqual(["meta", "google"]);
    expect(matchesTerms(["Ad A", "Meta"], splitTerms("google, meta"))).toBe(true);
    expect(matchesTerms(["Ad A", "Meta"], splitTerms("google"))).toBe(false);
    expect(matchesTerms(["x"], [])).toBe(true);
  });
  it("date range is inclusive and a missing date is out when a bound is set", () => {
    expect(inRange("2026-05-12", "2026-05-01", "2026-05-12")).toBe(true);
    expect(inRange("2026-05-13", "2026-05-01", "2026-05-12")).toBe(false);
    expect(inRange(null, "2026-05-01", "")).toBe(false);
    expect(inRange(null, "", "")).toBe(true);
  });
});

describe("metrics", () => {
  it("CPL, CPP, L2P, V2L; no divide by zero", () => {
    const m = metrics(10000, 50, 5, 1, 100000);
    expect([m.cpl, m.cpp, m.l2p, m.v2l, m.p2e]).toEqual([200, 2000, 10, 0.05, 20]);
    const z = metrics(500, 0, 0, 0, 0);
    expect([z.cpl, z.cpp, z.l2p, z.v2l]).toEqual([null, null, null, null]);
  });
  it("rows sharing a UTM share their leads: counted once (and per campaign in a cohort view)", () => {
    const rows = [
      perf({ id: "1", utm_key: "u", campaign_id: "c9", cost: 100, leads: 10, payments: 2 }),
      perf({ id: "2", utm_key: "u", campaign_id: "c9", cost: 50, leads: 10, payments: 2 }),
      perf({ id: "3", utm_key: "u", campaign_id: "c10", cost: 25, leads: 4, payments: 1 }),
      perf({ id: "4", utm_key: null, cost: 10, leads: 0 }),
    ];
    expect(totals(rows, false)).toMatchObject({ spend: 185, leads: 10, payments: 2 });
    expect(totals(rows, true)).toMatchObject({ spend: 185, leads: 14, payments: 3 });
    const g = groupTotals(rows, (r) => r.campaign_id ?? "-", true);
    expect(g.map((x) => [x.key, x.m.spend, x.m.leads])).toEqual([["c9", 150, 10], ["c10", 25, 4], ["-", 10, 0]]);
  });
  it("best cards: lowest CPP needs a payment; L2P and V2L need at least 20 leads", () => {
    const rows = [
      perf({ id: "tiny", cost: 1000, leads: 1, payments: 1, views: 10 }),            // 100% L2P but only 1 lead
      perf({ id: "good", cost: 40000, leads: 40, payments: 8, views: 20000 }),       // 20% L2P, CPP 5000
      perf({ id: "cheap", cost: 8000, leads: 25, payments: 4, views: 100000 }),      // CPP 2000, 16%
      perf({ id: "none", cost: 500, leads: 30, payments: 0 }),
    ];
    expect(lowestCpp(rows)?.row.id).toBe("tiny");
    expect(highestL2p(rows)?.row.id).toBe("good");
    expect(bestV2l(rows)?.row.id).toBe("good");
    expect(highestL2p([perf({ leads: 19, payments: 10 })])).toBeNull();
  });
});

describe("listing cards", () => {
  it("ads: unique / running / paused by UTM; in-window per UTM+campaign; all-time per UTM", () => {
    const rows = [
      ad({ id: "1", utm_key: "u1", campaign_id: "c9", spend: 100, leads: 3, payments: 2, enrollments: 1, leads_all: 4, payments_all: 3, enrollments_all: 1 }),
      ad({ id: "2", utm_key: "u1", campaign_id: "c9", spend: 50, leads: 3, payments: 2, enrollments: 1, leads_all: 4, payments_all: 3, enrollments_all: 1, campaign_status: "Paused" }),
      ad({ id: "3", utm_key: "u1", campaign_id: "c10", spend: 10, leads: 1, payments: 1, enrollments: 0, leads_all: 4, payments_all: 3, enrollments_all: 1 }),
      ad({ id: "4", utm_key: "u2", campaign_id: "c9", spend: 5, leads: 2, payments: 1, enrollments: 0, leads_all: 2, payments_all: 1, enrollments_all: 0, campaign_status: "Paused" }),
      ad({ id: "5", utm_key: null, spend: 1 }),
    ];
    const c = adCards(rows);
    expect([c.uniqueAds, c.running, c.paused, c.spend]).toEqual([3, 2, 2, 166]);
    expect(c.iw).toEqual({ l: 6, p: 4, e: 1 });
    expect(c.all).toEqual({ l: 6, p: 4, e: 1 });
    expect(c.anyWindow).toBe(true);
  });
  it("influencers: live posts, unique channels, spend, views", () => {
    const p = (o: Partial<PostRow>) => ({ influencer_id: "i1", live_status: "Live", cost: 0, actual_views: null, ...o }) as PostRow;
    expect(inflCards([p({ cost: 25000, actual_views: 17200 }), p({ influencer_id: "i2", live_status: "Planned", cost: 0 }), p({ cost: 100, actual_views: 5 })]))
      .toEqual({ postsLive: 2, channels: 2, spend: 25100, views: 17205 });
  });
});

describe("weeks", () => {
  it("monday of a week; gaps filled with zero", () => {
    expect(mondayOf("2026-05-03")).toBe("2026-04-27");
    expect(mondayOf("2026-05-04")).toBe("2026-05-04");
    const w = fillWeeks([{ week: "2026-04-27", leads: 2, payments: 0, enrollments: 0 }, { week: "2026-05-18", leads: 0, payments: 1, enrollments: 0 }]);
    expect(w.map((x) => [x.week, x.leads, x.payments])).toEqual([["2026-04-27", 2, 0], ["2026-05-04", 0, 0], ["2026-05-11", 0, 0], ["2026-05-18", 0, 1]]);
    // 1 May 2026 is a Friday and 12 May a Tuesday: the weeks of 27 Apr, 4 May and 11 May
    expect(fillWeeks([], "2026-05-01", "2026-05-12").map((x) => x.week)).toEqual(["2026-04-27", "2026-05-04", "2026-05-11"]);
    expect(fillWeeks([])).toEqual([]);
  });

  it("money typed with Indian commas or ₹ is read as a number", () => {
    expect(parseAmount("1,00,000")).toBe(100000);
    expect(parseAmount("₹50,000")).toBe(50000);
    expect(parseAmount(" 2500 ")).toBe(2500);
    expect(parseAmount("12.5")).toBe(12.5);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("abc")).toBeNull();
  });

  it("y ticks are whole numbers with no repeats", () => {
    expect(countTicks(0)).toEqual({ top: 1, ticks: [0, 1] });
    expect(countTicks(1)).toEqual({ top: 1, ticks: [0, 1] });
    expect(countTicks(3)).toEqual({ top: 4, ticks: [0, 2, 4] });
    expect(countTicks(7)).toEqual({ top: 10, ticks: [0, 5, 10] });
    expect(countTicks(16)).toEqual({ top: 20, ticks: [0, 10, 20] });
    expect(countTicks(950)).toEqual({ top: 1000, ticks: [0, 500, 1000] });
    for (const m of [0, 1, 2, 3, 4, 5, 9, 11, 37, 101, 2500]) {
      const { top, ticks } = countTicks(m);
      expect(top).toBeGreaterThanOrEqual(m);
      expect(new Set(ticks).size).toBe(ticks.length);
      expect(ticks.every((v) => Number.isInteger(v))).toBe(true);
    }
  });

  it("x labels never closer than the gap; first and last always shown", () => {
    const xs = Array.from({ length: 30 }, (_, i) => 40 + i * 12);   // 30 weeks, 12px apart
    const idx = labelIndexes(xs, 60);
    expect(idx[0]).toBe(0);
    expect(idx[idx.length - 1]).toBe(29);
    for (let i = 1; i < idx.length; i++) expect(xs[idx[i]] - xs[idx[i - 1]]).toBeGreaterThanOrEqual(60);
    expect(labelIndexes([100], 60)).toEqual([0]);
    expect(labelIndexes([40, 380], 60)).toEqual([0, 1]);
    expect(labelIndexes([40, 70], 60)).toEqual([0, 1]);                 // two points: both labelled (start / end anchored)
  });
});

describe("csv import", () => {
  const cols: CustomColumn[] = [{ channel: "ads", key: "x_creative_type", label: "Creative Type", type: "select", required: true, options: ["Static", "Video"] }];
  it("maps the usual headings and custom labels; computed columns are ignored, unknown ones reported", () => {
    const r = csvToRows('Ad Name,Used In,Platform,Spend,UTM Link,Leads,Creative Type,Mood\n"Ad, one",VSAT-9,Meta,"12,000",https://x.org/?utm_source=a,15,Video,happy\n', "ads", cols);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.rows).toEqual([{ ad_name: "Ad, one", campaign: "VSAT-9", platform: "Meta", spend: "12,000", utm_link: "https://x.org/?utm_source=a", extra: { x_creative_type: "Video" } }]);
    expect(r.data.ignored).toEqual(["Leads"]);
    expect(r.data.unknown).toEqual(["Mood"]);
  });
  it("influencer headings, empty cells left out, header-only file refused", () => {
    const r = csvToRows("Influencer,Platform,Live Status,Views\nHiten Codes,YouTube Shorts,Live,\n", "influencers", []);
    expect(r.ok && r.data.rows).toEqual([{ influencer: "Hiten Codes", platform: "YouTube Shorts", live_status: "Live" }]);
    expect(csvToRows("Ad Name\n", "ads", []).ok).toBe(false);
    expect(csvToRows("Foo,Bar\n1,2\n", "ads", []).ok).toBe(false);
  });
  it("database import errors become row-numbered lines (header = row 1)", () => {
    expect(importErrors('[{"row":2,"error":"BAD_VALUE: platform"},{"row":5,"error":"REQUIRED: x_creative_type"}]', () => "Creative Type"))
      .toEqual(["Row 3: Platform has a value that is not allowed.", "Row 6: Creative Type is required."]);
    expect(importErrors("not json", (k) => k)).toEqual([]);
  });
});

describe("errors + format", () => {
  it("codes become plain sentences; unknown text is never echoed", () => {
    expect(errorText("REQUIRED: campaign")).toBe("Used in (campaign) is required.");
    expect(errorText("BAD_VALUE: campaign")).toMatch(/does not exist/);
    expect(errorText("REQUIRED: x_creative_type", () => "Creative Type")).toBe("Creative Type is required.");
    expect(errorText("FORBIDDEN")).toMatch(/Only admins/);
    expect(errorText("<script>alert(1)</script>")).toBe("Something went wrong. Please try again.");
  });
  it("compact numbers in lakh / crore", () => {
    expect(fmtCompact(43044767)).toBe("4.30Cr");
    expect(fmtCompact(1502000)).toBe("15.02L");
    expect(fmtCompact(9266)).toBe("9,266");
  });
  it("YouTube ids from every link shape; others null", () => {
    expect(youTubeId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10")).toBe("dQw4w9WgXcQ");
    expect(youTubeId("https://youtu.be/dQw4w9WgXcQ?si=x")).toBe("dQw4w9WgXcQ");
    expect(youTubeId("https://youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youTubeId("https://www.instagram.com/reel/abc")).toBeNull();
    expect(youTubeId("javascript:alert(1)")).toBeNull();
  });
});
