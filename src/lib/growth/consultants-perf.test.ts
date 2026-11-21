import { describe, expect, it } from "vitest";
import {
  LEAD_STAGE, NO_BDM, NO_CITY, activePreset, applyFilters, breakdownKpis, breakdownRows, campusCode, drillRows, journeyRows, monthStartIST,
  nextSort, parseTarget, rollup, rowKpis, sortByNum, stageBreakdown, stageCounts, stageLabel, targetNote, toConsultant, todayIST,
  unpaidLeads, windowParams, type PerfRow, type PerfStudent,
} from "./consultants-perf";

const row = (o: Partial<PerfRow> & { name: string }): PerfRow => ({
  category: "Associated with Sunstone", cities: ["Pune"], bdms: ["Asha"], rows: 1, leads: 0, apps_utm: 0, apps_coupon: 0, enrolled: 0,
  enrollment_spend: 0, slab_spend: 0, stages: {}, ...o,
});
const stu = (o: Partial<PerfStudent> & { lead_id: string }): PerfStudent => ({
  consultant_name: "A", city: "Pune", bdm: "Asha", category: null, via: "utm", name: "x", email: null, mobile: null, registration_date: null,
  campus_preference: null, stage: "no_application", payment_status: "Not paid", is_paid: false, is_enrolled: false,
  in_lead_window: false, in_pay_window: false, in_enr_window: false, ...o,
});

describe("toConsultant", () => {
  it("adds up applications and spend, takes the first city / BDM, marks active", () => {
    const c = toConsultant(row({ name: "A", cities: ["Pune", "Mumbai"], bdms: ["", "Ravi"], leads: 0, apps_utm: 1, apps_coupon: 2, enrollment_spend: "1500.00", slab_spend: 500 }));
    expect(c).toMatchObject({ city: "Pune", cityList: ["Pune", "Mumbai"], bdm: "Ravi", payments: 3, spend: 2000, active: true });
  });
  it("no city / BDM → placeholders; nothing → inactive", () => {
    const c = toConsultant(row({ name: "B", cities: [], bdms: [] }));
    expect(c).toMatchObject({ city: NO_CITY, cityList: [NO_CITY], bdm: NO_BDM, active: false, spend: 0 });
  });
});

describe("campus", () => {
  it("applies only with exactly one campus", () => {
    expect(campusCode([])).toBeNull();
    expect(campusCode(["Gurugram Campus"])).toBe("GGN");
    expect(campusCode(["ADYPU Pune"])).toBe("PUNE");
    expect(campusCode(["Gurugram Campus", "ADYPU Pune"])).toBeNull();
  });
});

describe("filters and order", () => {
  const list = [
    toConsultant(row({ name: "B", leads: 5, enrolled: 1, cities: ["Pune", "Nagpur"] })),
    toConsultant(row({ name: "A", leads: 9, enrolled: 1, category: "Not Associated with Sunstone", cities: ["Delhi"], bdms: ["Ravi"] })),
    toConsultant(row({ name: "C", leads: 0, enrolled: 0 })),
  ];
  it("breakdown: default order enrolments, leads, name; a city matches any of a consultant's cities", () => {
    expect(breakdownRows(list, [], []).map((c) => c.name)).toEqual(["A", "B", "C"]);
    expect(breakdownRows(list, [], ["Nagpur"]).map((c) => c.name)).toEqual(["B"]);
    expect(breakdownRows(list, ["Not Associated with Sunstone"], []).map((c) => c.name)).toEqual(["A"]);
  });
  it("BDM / City filters, status active / inactive", () => {
    expect(applyFilters(list, { category: [], city: [], bdm: ["Ravi"], status: [] }).map((c) => c.name)).toEqual(["A"]);
    expect(applyFilters(list, { category: [], city: [], bdm: [], status: ["inactive"] }).map((c) => c.name)).toEqual(["C"]);
    expect(applyFilters(list, { category: [], city: ["Nagpur"], bdm: [], status: [] })).toEqual([]);   // first city only, as the CRM
  });
  it("sort: new column desc, same column flips; desc is the reversed stable ascending (CRM)", () => {
    expect(nextSort({ key: "leads", dir: "desc" }, "leads")).toEqual({ key: "leads", dir: "asc" });
    expect(nextSort({ key: "leads", dir: "asc" }, "payments")).toEqual({ key: "payments", dir: "desc" });
    const r = [{ n: "x", v: 1 }, { n: "y", v: 2 }, { n: "z", v: 1 }];
    expect(sortByNum(r, (a) => a.v, "desc").map((a) => a.n)).toEqual(["y", "z", "x"]);
    expect(sortByNum(r, (a) => a.v, "asc").map((a) => a.n)).toEqual(["x", "z", "y"]);
  });
});

describe("KPI cards", () => {
  const list = [
    toConsultant(row({ name: "A", leads: 2, apps_utm: 1, apps_coupon: 2, enrolled: 2, enrollment_spend: 100, slab_spend: 50 })),
    toConsultant(row({ name: "B", category: "Not Associated with Sunstone" })),
    toConsultant(row({ name: "C", category: null })),
  ];
  it("breakdown cards", () => {
    expect(breakdownKpis(list)).toEqual({ consultants: 3, associated: 1, notAssociated: 1, active: 1, leads: 2, appUtm: 1, appCoupon: 2,
      payments: 3, enrolled: 2, enrollSpend: 100, slabSpend: 50, totalSpend: 150 });
  });
  it("BDM / City cards", () => {
    expect(rowKpis(list)).toEqual({ total: 3, active: 1, leads: 2, appUtm: 1, appCoupon: 2, payments: 3, enrolled: 2 });
  });
});

describe("rollup", () => {
  const list = [
    toConsultant(row({ name: "A", bdms: ["Asha"], cities: ["Pune"], leads: 1, enrolled: 1 })),
    toConsultant(row({ name: "B", bdms: ["Asha"], cities: ["Delhi"], apps_utm: 2 })),
    toConsultant(row({ name: "C", bdms: ["Ravi"], cities: ["Pune"] })),
  ];
  it("by BDM: cities, counts, sums", () => {
    const g = rollup(list, "bdm");
    expect(g.map((x) => [x.key, x.others, x.totalCount, x.activeCount, x.leads, x.payments, x.enrolled]))
      .toEqual([["Asha", ["Pune", "Delhi"], 2, 2, 1, 2, 1], ["Ravi", ["Pune"], 1, 0, 0, 0, 0]]);
  });
  it("by city: BDMs", () => {
    expect(rollup(list, "city").map((x) => [x.key, x.others])).toEqual([["Pune", ["Asha", "Ravi"]], ["Delhi", ["Asha"]]]);
  });
});

describe("city targets", () => {
  it("note: percent and difference, green once hit; none without a target", () => {
    expect(targetNote(4, 10)).toEqual({ pct: 40, diff: -6, hit: false });
    expect(targetNote(12, 10)).toEqual({ pct: 120, diff: 2, hit: true });
    expect(targetNote(3, 0)).toBeNull();
  });
  it("parse: whole numbers 0..10,00,000 only", () => {
    expect(parseTarget("1,500")).toBe(1500);
    expect(parseTarget(" ")).toBe(0);
    expect(parseTarget("-3")).toBeNull();
    expect(parseTarget("1.5")).toBeNull();
    expect(parseTarget("abc")).toBeNull();
    expect(parseTarget("1000001")).toBeNull();
    expect(parseTarget("1000000")).toBe(1000000);
  });
});

describe("journey", () => {
  const list = [
    toConsultant(row({ name: "A", leads: 3, stages: { enrolled: 2, counselling_done: 1, offer_cancelled: 1, slot_selected: 1, weird_stage: 1 } })),
    toConsultant(row({ name: "B", leads: 0, stages: {} })),           // no leads, no applications → not shown
    toConsultant(row({ name: "C", leads: 1, cities: [] })),
  ];
  it("buckets stages into the CRM columns; OL cancelled inside Counselling but in App Total; unknown → Other", () => {
    const j = journeyRows(list, [], []);
    expect(j.rows.map((r) => r.name)).toEqual(["A", "C"]);
    const a = j.rows[0];
    expect(a.total).toBe(6);
    expect(a.cols).toEqual({ enrolled: 2, counsel: 1, enable_exam: 1, other: 1 });
    expect(a.ol).toBe(1);
    expect(j).toMatchObject({ leads: 4, total: 6, ol: 1, hasOther: true });
    expect(j.rows[1].city).toBe("");
  });
  it("category / city filters", () => {
    expect(journeyRows(list, [], ["Pune"]).rows.map((r) => r.name)).toEqual(["A"]);
    expect(journeyRows(list, ["Not Associated with Sunstone"], []).rows).toEqual([]);
  });
});

describe("KPI drill-downs", () => {
  const s = [
    stu({ lead_id: "1", consultant_name: "A", in_lead_window: true, in_pay_window: true, is_paid: true, stage: "enrolled", is_enrolled: true, in_enr_window: true }),
    stu({ lead_id: "2", consultant_name: "A", in_lead_window: true }),
    stu({ lead_id: "3", consultant_name: "a ", via: "coupon", in_pay_window: true, is_paid: true }),
    stu({ lead_id: "4", consultant_name: "Z", in_lead_window: true }),
  ];
  const vis = new Set(["a"]);
  it("rows of each card, only visible consultants (name without case)", () => {
    expect(drillRows(s, vis, "lead").map((x) => x.lead_id)).toEqual(["1", "2"]);
    expect(drillRows(s, vis, "application").map((x) => x.lead_id)).toEqual(["1", "3"]);
    expect(drillRows(s, vis, "enrollment").map((x) => x.lead_id)).toEqual(["1"]);
  });
  it("not-paid leads + stage breakdown (percent of all, lead stage first)", () => {
    const unpaid = unpaidLeads(s, vis);
    expect(unpaid.map((x) => x.lead_id)).toEqual(["2"]);
    const b = stageBreakdown(drillRows(s, vis, "application"), unpaid.length);
    expect(b.map((x) => [x.stage, x.n, Math.round(x.pct)])).toEqual([[LEAD_STAGE, 1, 33], ["enrolled", 1, 33], ["no_application", 1, 33]]);
  });
  it("consultant drill: stage counts in pipeline order", () => {
    expect(stageCounts(s)).toEqual([["no_application", 3], ["enrolled", 1]]);
  });
  it("stage labels", () => {
    expect(stageLabel("vsat_not_cleared")).toBe("VSAT not cleared");
    expect(stageLabel("no_application")).toBe("No application yet");
    expect(stageLabel(null)).toBe("—");
  });
});

describe("dates", () => {
  const now = new Date("2026-11-20T20:00:00Z");   // 21 Nov, 01:30 India time
  it("India day and month start", () => {
    expect(todayIST(now)).toBe("2026-11-21");
    expect(monthStartIST(now)).toBe("2026-11-01");
  });
  it("presets", () => {
    expect(activePreset({ start: null, end: null }, now)).toBe("all");
    expect(activePreset({ start: "2026-11-21", end: "2026-11-21" }, now)).toBe("today");
    expect(activePreset({ start: "2026-11-01", end: "2026-11-21" }, now)).toBe("mtd");
    expect(activePreset({ start: "2026-10-01", end: null }, now)).toBe("custom");
  });
  it("request body only carries the keys that are set", () => {
    expect(windowParams({ start: null, end: null }, null)).toEqual({});
    expect(windowParams({ start: "2026-11-01", end: null }, "GGN")).toEqual({ start: "2026-11-01", campus: "GGN" });
  });
});
