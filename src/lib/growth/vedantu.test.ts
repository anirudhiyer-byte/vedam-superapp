import { describe, expect, it } from "vitest";
import {
  anyFilter, cellText, comparison, filterRows, fmtInr, kpis, mapRecords, mappingErrors, nextSort, optionsOf, parseCsv, serialsOf,
  sortRows, toCsv, totalCpa, totalSpend, valueOf, vdError, importErrorLines, VIEW_COMPARISON, NO_FILTERS, type VdColumn, type VdRow,
} from "./vedantu";

const row = (o: Partial<VdRow> & { id: string }): VdRow => ({
  channel: "Chan A", live_link: "https://youtu.be/a", utm_link: "https://x.test/a?utm_source=yt&utm_medium=m&utm_campaign=c",
  live_date: "2026-01-10", campaign_id: "c1", campaign: "VSAT-10", expected_views: null, actual_views: null, video_spend: 0, cpa: 0,
  notes: null, extra: {}, created_at: "", updated_at: "", deleted_at: null, utm_key: null,
  leads: 0, payments: 0, enrollments: 0, leads_all: 0, payments_all: 0, enrollments_all: 0, ...o,
});
const col = (key: string, type: VdColumn["type"] = "text", label = key): VdColumn => ({ key, label, type, required: false, standard: true, hidden: false });
const COLS: VdColumn[] = [
  col("serial_no", "computed", "Serial No"), { ...col("channel", "text", "Channel"), required: true },
  { ...col("utm_link", "url", "UTM Link"), required: true }, { ...col("live_date", "date", "Live Date"), required: true },
  col("expected_views", "number", "Expected Views"), col("actual_views", "number", "Actual Views"),
  col("video_spend", "number", "Video Spend"), col("cpa", "number", "CPA"), col("total_cpa", "computed", "Total CPA"),
  { ...col("x_city", "text", "City"), standard: false },
];

describe("counts", () => {
  it("Enrollments column is all-time (as the CRM); Leads / Payments keep In Window and All Time", () => {
    const r = row({ id: "1", leads: 2, leads_all: 5, payments: 1, payments_all: 3, enrollments: 0, enrollments_all: 2 });
    expect(valueOf(r, "enrollments")).toBe(2);
    expect(valueOf(r, "leads")).toBe(2);
    expect(valueOf(r, "leads_all")).toBe(5);
    expect(valueOf(r, "payments")).toBe(1);
    expect(valueOf(r, "payments_all")).toBe(3);
  });
});

describe("spend", () => {
  it("Total CPA = CPA × all-time payments; Total Spend = Video Spend + Total CPA", () => {
    const r = row({ id: "1", cpa: 500, payments: 1, payments_all: 4, video_spend: 10000 });
    expect(totalCpa(r)).toBe(2000);
    expect(totalSpend(r)).toBe(12000);
    expect(valueOf(r, "total_cpa")).toBe(2000);
  });
  it("empty Video Spend / CPA show as nothing; table numbers have no ₹", () => {
    expect(valueOf(row({ id: "1" }), "video_spend")).toBeNull();
    expect(cellText(COLS[6], 1500)).toBe("1,500");
    expect(cellText(COLS[6], null)).toBe("—");
    expect(fmtInr(1500)).toBe("₹1,500");
  });
});

describe("Serial No", () => {
  it("counts in Live Date order, oldest first, regardless of list order", () => {
    const s = serialsOf([row({ id: "new", live_date: "2026-03-01" }), row({ id: "old", live_date: "2026-01-01" }), row({ id: "mid", live_date: "2026-02-01" })]);
    expect([s.get("old"), s.get("mid"), s.get("new")]).toEqual([1, 2, 3]);
  });
});

describe("View Comparison", () => {
  it("no expected → fill; no actual → none; else % and difference", () => {
    expect(comparison(row({ id: "1" })).kind).toBe("fill");
    expect(comparison(row({ id: "1", expected_views: 0, actual_views: 5 })).kind).toBe("fill");
    expect(comparison(row({ id: "1", expected_views: 100 })).kind).toBe("none");
    const c = comparison(row({ id: "1", expected_views: 1000, actual_views: 1250 }));
    expect(c).toEqual({ kind: "ok", pct: 25, abs: 250 });
    expect(valueOf(row({ id: "1", expected_views: 1000, actual_views: 500 }), VIEW_COMPARISON)).toBe(-50);
  });
});

describe("filters", () => {
  const rows = [
    row({ id: "1", channel: "Alpha Show", campaign: "VSAT-10" }),
    row({ id: "2", channel: "Beta", campaign: "VSAT-11", utm_link: "https://x.test/b?utm_campaign=zzz" }),
    row({ id: "3", channel: "Gamma", campaign: null, live_link: null }),
  ];
  it("search is a comma OR over channel, campaign, UTM, live link", () => {
    expect(filterRows(rows, { ...NO_FILTERS, q: "alpha" }).map((r) => r.id)).toEqual(["1"]);
    expect(filterRows(rows, { ...NO_FILTERS, q: "alpha, vsat-11" }).map((r) => r.id)).toEqual(["1", "2"]);
    expect(filterRows(rows, { ...NO_FILTERS, q: "zzz" }).map((r) => r.id)).toEqual(["2"]);
    expect(filterRows(rows, NO_FILTERS)).toHaveLength(3);
  });
  it("dropdowns narrow further; options come from the rows", () => {
    expect(filterRows(rows, { ...NO_FILTERS, campaign: "VSAT-11" }).map((r) => r.id)).toEqual(["2"]);
    expect(filterRows(rows, { q: "beta", campaign: "VSAT-10", channel: "" })).toHaveLength(0);
    expect(optionsOf(rows, "campaign")).toEqual(["VSAT-10", "VSAT-11"]);
    expect(optionsOf(rows, "channel")).toEqual(["Alpha Show", "Beta", "Gamma"]);
    expect(anyFilter(NO_FILTERS)).toBe(false);
    expect(anyFilter({ ...NO_FILTERS, channel: "x" })).toBe(true);
  });
});

describe("sort", () => {
  it("cycles asc → desc → none and keeps empty values last", () => {
    let s = nextSort(null, "actual_views");
    expect(s).toEqual({ key: "actual_views", dir: "asc" });
    s = nextSort(s, "actual_views");
    expect(s?.dir).toBe("desc");
    expect(nextSort(s, "actual_views")).toBeNull();
    const rows = [row({ id: "a", actual_views: 5 }), row({ id: "b" }), row({ id: "c", actual_views: 50 })];
    const sr = serialsOf(rows);
    expect(sortRows(rows, { key: "actual_views", dir: "asc" }, sr).map((r) => r.id)).toEqual(["a", "c", "b"]);
    expect(sortRows(rows, { key: "actual_views", dir: "desc" }, sr).map((r) => r.id)).toEqual(["c", "a", "b"]);
  });
});

describe("KPI cards", () => {
  it("follow the rows given", () => {
    const rows = [
      row({ id: "1", video_spend: 1000, cpa: 100, payments_all: 3, actual_views: 400 }),
      row({ id: "2", video_spend: 500, actual_views: 100 }),
    ];
    expect(kpis(rows)).toEqual({ postsLive: 2, totalSpend: 1800, videoSpend: 1500, totalCpaSpend: 300, totalViews: 500 });
    expect(kpis([]).postsLive).toBe(0);
  });
});

describe("CSV export", () => {
  it("writes labels, computed values, added columns and escapes", () => {
    const r = row({ id: "1", channel: 'He said "hi", ok', extra: { x_city: "Pune" }, cpa: 100, payments_all: 2 });
    const csv = toCsv([r], COLS, serialsOf([r]));
    const [head, line] = csv.split("\r\n");
    expect(head).toBe("Serial No,Channel,UTM Link,Live Date,Expected Views,Actual Views,Video Spend,CPA,Total CPA,City");
    expect(line).toContain('"He said ""hi"", ok"');
    expect(line.endsWith(",200,Pune")).toBe(true);
  });
});

describe("CSV upload", () => {
  const text = "Channel Name,UTM,Live Date,Views,City,Junk\nA,https://x.test/a,2026-01-01,100,Pune,z\n";
  it("guesses headers (aliases, labels), one header per column", () => {
    const p = parseCsv(text, COLS);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.data.guess).toEqual(["channel", "utm_link", "live_date", "actual_views", "x_city", ""]);
    expect(mapRecords(p.data, p.data.guess, COLS)).toEqual([{ channel: "A", utm_link: "https://x.test/a", live_date: "2026-01-01", actual_views: "100", extra: { x_city: "Pune" } }]);
  });
  it("refuses empty / header-only files", () => {
    expect(parseCsv("", COLS).ok).toBe(false);
    expect(parseCsv("Channel,UTM\n", COLS).ok).toBe(false);
  });
  it("mapping: UTM always needed; Add mode needs the required columns; update mode does not", () => {
    expect(mappingErrors(["utm_link", "actual_views"], COLS, "upsert")).toEqual([]);
    expect(mappingErrors(["actual_views"], COLS, "upsert").join(" ")).toContain("UTM Link");
    expect(mappingErrors(["utm_link"], COLS, "add").join(" ")).toContain("Channel");
    expect(mappingErrors(["utm_link", "utm_link"], COLS, "upsert").join(" ")).toContain("2 headers");
  });
});

describe("errors", () => {
  it("turns database codes into plain sentences", () => {
    expect(vdError("REQUIRED: channel")).toBe("Channel is required.");
    expect(vdError("BAD_VALUE: utm_link")).toContain("http");
    expect(vdError("DUPLICATE_UTM", "Chan A")).toContain("Chan A");
    expect(vdError("BAD_VALUE: x_city", null, (k) => (k === "x_city" ? "City" : undefined))).toContain("City");
    expect(vdError("weird")).toBe("Something went wrong. Please try again.");
  });
  it("lists import errors by file line", () => {
    const lines = importErrorLines(JSON.stringify([{ row: 1, error: "REQUIRED: channel" }]), () => undefined);
    expect(lines).toEqual(["Line 2: Channel is required."]);
    expect(importErrorLines("not json", () => undefined)).toEqual([]);
  });
});
