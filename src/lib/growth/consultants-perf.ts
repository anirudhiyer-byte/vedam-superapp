/**
 * Growth → Consultants Channel → Consultant Performance (migration 0131) · pure helpers.
 *
 * The database (growth_cons_perf, growth_cons_perf_students) does the counting, with the same rules as the
 * Consultant Listing (0130): a lead is counted once (by UTM, else by the coupon's oldest row), staff are left out,
 * days are India time. These helpers only shape, filter, sort and add up what it returned, the way the
 * vedamcrm360 Consultants Dashboard does on its rollup:
 *   • Applications = UTM + coupon payments in the period; Enrollments = enrolments in the period (strict)
 *   • Total Spend = Enrollment Spend + Slab Spend; "Active" = leads > 0 or applications > 0
 *   • Campus filter: exactly one campus chosen → that campus; none or both → all
 */
import { stageLabel as humanStage } from "@/components/admin/communication/lib/live-lists";

// ───────────────────────────── types (same keys the database returns) ─────────────────────────────

export type PerfRow = {
  name: string; category: string | null; cities: string[]; bdms: string[]; rows: number;
  leads: number; apps_utm: number; apps_coupon: number; enrolled: number;
  enrollment_spend: number | string | null; slab_spend: number | string | null; stages: Record<string, number>;
};
export type PerfWindow = { start: string | null; end: string | null; campus: string | null };
export type PerfData = { consultants: PerfRow[]; window: PerfWindow };

export type PerfStudent = {
  lead_id: string; consultant_name: string; city: string | null; bdm: string | null; category: string | null; via: "utm" | "coupon";
  name: string | null; email: string | null; mobile: string | null; registration_date: string | null; campus_preference: string | null;
  stage: string; payment_status: string; is_paid: boolean; is_enrolled: boolean;
  in_lead_window: boolean; in_pay_window: boolean; in_enr_window: boolean;
};
export type PerfStudents = { students: PerfStudent[]; total: number; truncated: boolean; window: PerfWindow };

export type Consultant = {
  name: string; category: string; city: string; cityList: string[]; bdm: string;
  leads: number; appUtm: number; appCoupon: number; payments: number; enrolled: number;
  enrollSpend: number; slabSpend: number; spend: number; stages: Record<string, number>; active: boolean;
};

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
export const NO_CITY = "(No City)";
export const NO_BDM = "(No BDM)";

/** One database row → the CRM's per-consultant object. City / BDM = the first one (as the CRM pivot). */
export function toConsultant(r: PerfRow): Consultant {
  const cityList = (r.cities ?? []).filter((c) => c && c.trim());
  const enrollSpend = n(r.enrollment_spend), slabSpend = n(r.slab_spend);
  const appUtm = n(r.apps_utm), appCoupon = n(r.apps_coupon), leads = n(r.leads);
  return {
    name: r.name, category: r.category ?? "", city: cityList[0] ?? NO_CITY, cityList: cityList.length ? cityList : [NO_CITY],
    bdm: (r.bdms ?? []).find((b) => b && b.trim()) ?? NO_BDM,
    leads, appUtm, appCoupon, payments: appUtm + appCoupon, enrolled: n(r.enrolled),
    enrollSpend, slabSpend, spend: enrollSpend + slabSpend, stages: r.stages ?? {}, active: leads > 0 || appUtm + appCoupon > 0,
  };
}

// ───────────────────────────── filters ─────────────────────────────

export const CAMPUS_OPTIONS = ["Gurugram Campus", "ADYPU Pune"] as const;
const CAMPUS_CODE: Record<string, "GGN" | "PUNE"> = { "Gurugram Campus": "GGN", "ADYPU Pune": "PUNE" };
/** CRM rule: the campus filter applies only when exactly one campus is chosen. */
export const campusCode = (sel: string[]): "GGN" | "PUNE" | null => (sel.length === 1 ? CAMPUS_CODE[sel[0]] ?? null : null);

export type Filters = { category: string[]; city: string[]; bdm: string[]; status: string[] };
export const NO_FILTERS: Filters = { category: [], city: [], bdm: [], status: [] };
export const anyFilter = (f: Filters) => !!(f.category.length || f.city.length || f.bdm.length || f.status.length);

/** BDM / City tabs: city and BDM are the consultant's first one. Status: "active" / "inactive". */
export function applyFilters(list: Consultant[], f: Filters): Consultant[] {
  return list.filter((c) =>
    (f.category.length === 0 || f.category.includes(c.category)) &&
    (f.city.length === 0 || f.city.includes(c.city)) &&
    (f.bdm.length === 0 || f.bdm.includes(c.bdm)) &&
    (f.status.length === 0 || (f.status.includes("active") && c.active) || (f.status.includes("inactive") && !c.active)));
}

/** Breakdown tab: a consultant in several cities matches any of them. Default order = enrolments, leads, name. */
export function breakdownRows(list: Consultant[], category: string[], city: string[]): Consultant[] {
  return list
    .filter((c) => (category.length === 0 || category.includes(c.category)) && (city.length === 0 || c.cityList.some((x) => city.includes(x))))
    .sort((a, b) => b.enrolled - a.enrolled || b.leads - a.leads || a.name.localeCompare(b.name));
}

export const distinctSorted = (xs: string[]) => Array.from(new Set(xs)).sort();

// ───────────────────────────── sort (CRM: new column → desc, same column → flip) ─────────────────────────────

export type SortState = { key: string; dir: "asc" | "desc" };
export function nextSort(cur: SortState, key: string): SortState {
  return cur.key === key ? { key, dir: cur.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" };
}
/** Same as the CRM: a stable ascending sort, reversed for descending. */
export function sortByNum<T>(rows: T[], get: (r: T) => number, dir: "asc" | "desc"): T[] {
  const out = [...rows].sort((a, b) => get(a) - get(b));
  return dir === "desc" ? out.reverse() : out;
}

// ───────────────────────────── KPI cards ─────────────────────────────

export type BreakdownKpis = {
  consultants: number; associated: number; notAssociated: number; active: number; leads: number;
  appUtm: number; appCoupon: number; payments: number; enrolled: number; enrollSpend: number; slabSpend: number; totalSpend: number;
};
export function breakdownKpis(list: Consultant[]): BreakdownKpis {
  const k: BreakdownKpis = { consultants: list.length, associated: 0, notAssociated: 0, active: 0, leads: 0, appUtm: 0, appCoupon: 0,
    payments: 0, enrolled: 0, enrollSpend: 0, slabSpend: 0, totalSpend: 0 };
  for (const c of list) {
    if (c.category === "Associated with Sunstone") k.associated++;
    else if (c.category) k.notAssociated++;
    if (c.active) k.active++;
    k.leads += c.leads; k.appUtm += c.appUtm; k.appCoupon += c.appCoupon; k.enrolled += c.enrolled;
    k.enrollSpend += c.enrollSpend; k.slabSpend += c.slabSpend;
  }
  k.payments = k.appUtm + k.appCoupon;
  k.totalSpend = k.enrollSpend + k.slabSpend;
  return k;
}

export type RowKpis = { total: number; active: number; leads: number; appUtm: number; appCoupon: number; payments: number; enrolled: number };
export function rowKpis(list: Consultant[]): RowKpis {
  const k: RowKpis = { total: list.length, active: 0, leads: 0, appUtm: 0, appCoupon: 0, payments: 0, enrolled: 0 };
  for (const c of list) {
    if (c.active) k.active++;
    k.leads += c.leads; k.appUtm += c.appUtm; k.appCoupon += c.appCoupon; k.enrolled += c.enrolled;
  }
  k.payments = k.appUtm + k.appCoupon;
  return k;
}

// ───────────────────────────── BDM / City roll-ups ─────────────────────────────

export type Group = { key: string; others: string[]; consultants: Consultant[]; totalCount: number; activeCount: number;
  leads: number; payments: number; enrolled: number; appUtm: number; appCoupon: number; spend: number };

/** Group consultants by BDM (others = their cities) or by city (others = their BDMs), first-seen order. */
export function rollup(list: Consultant[], by: "bdm" | "city"): Group[] {
  const map = new Map<string, Group & { set: Set<string> }>();
  for (const c of list) {
    const key = by === "bdm" ? c.bdm : c.city;
    let g = map.get(key);
    if (!g) { g = { key, others: [], set: new Set(), consultants: [], totalCount: 0, activeCount: 0, leads: 0, payments: 0, enrolled: 0, appUtm: 0, appCoupon: 0, spend: 0 }; map.set(key, g); }
    g.set.add(by === "bdm" ? c.city : c.bdm);
    g.consultants.push(c);
    g.totalCount++;
    if (c.active) g.activeCount++;
    g.leads += c.leads; g.payments += c.payments; g.enrolled += c.enrolled; g.appUtm += c.appUtm; g.appCoupon += c.appCoupon; g.spend += c.spend;
  }
  return Array.from(map.values()).map(({ set, ...g }) => ({ ...g, others: Array.from(set) }));
}

/** City target cell: "40% · -12" (green once the target is reached). */
export function targetNote(enrolled: number, target: number): { pct: number; diff: number; hit: boolean } | null {
  if (!(target > 0)) return null;
  return { pct: Math.round((enrolled / target) * 100), diff: enrolled - target, hit: enrolled >= target };
}

/** Target typed in the cell: digits only (1,500 → 1500); anything else → null (the database checks it again). */
export function parseTarget(raw: string): number | null {
  const s = raw.replace(/[,\s₹]/g, "");
  if (s === "") return 0;
  if (!/^\d+$/.test(s)) return null;
  const v = Number(s);
  return v <= 1_000_000 ? v : null;
}

// ───────────────────────────── stages ─────────────────────────────

/** Pipeline order of the staging stages (vm_app_stage), then "no_application" (paid, no application row yet). */
export const STAGE_ORDER = [
  "no_application", "payment_not_initiated", "payment_approved", "mock_enabled", "slot_selected", "exam_not_given",
  "vsat_cleared", "vsat_not_cleared", "interview_selected", "interview_rejected", "counselling_done", "offer_released",
  "offer_cancelled", "enrolled",
];
export const stageRank = (s: string) => { const i = STAGE_ORDER.indexOf(s); return i === -1 ? STAGE_ORDER.length : i; };
export const stageLabel = (s: string | null | undefined) =>
  !s ? "—" : s === "no_application" ? "No application yet" : s === "offer_cancelled" ? "Offer cancelled (OL)" : humanStage(s);

/**
 * Application Journey columns (the CRM's columns), with the staging stages that fall in each one.
 * OL Cancelled (offer_cancelled) is shown inside Counselling, as on the CRM, and still counts in App Total.
 */
export const JOURNEY_COLUMNS: { key: string; label: string; stages: string[] }[] = [
  { key: "app_start", label: "App Start", stages: ["no_application", "payment_not_initiated"] },
  { key: "app_submit", label: "App Submit", stages: ["payment_approved"] },
  { key: "enable_exam", label: "Enable Exam", stages: ["mock_enabled", "slot_selected", "exam_not_given"] },
  { key: "vsat_clr", label: "VSAT Clr", stages: ["vsat_cleared", "interview_selected"] },
  { key: "not_clr", label: "Not Clr", stages: ["vsat_not_cleared"] },
  { key: "pi_reject", label: "PI Reject", stages: ["interview_rejected"] },
  { key: "counsel", label: "Counsel", stages: ["counselling_done", "offer_released"] },
  { key: "enrolled", label: "Enrolled", stages: ["enrolled"] },
];
export const OL_STAGE = "offer_cancelled";
const COL_OF = new Map(JOURNEY_COLUMNS.flatMap((c) => c.stages.map((s) => [s, c.key] as const)));

export type JourneyRow = { name: string; city: string; leads: number; total: number; cols: Record<string, number>; ol: number };
/** Consultants with leads or applications (all time), filtered by category / city, sorted App Total, leads, name. */
export function journeyRows(list: Consultant[], category: string[], city: string[]): { rows: JourneyRow[]; totals: Record<string, number>; ol: number; leads: number; total: number; hasOther: boolean } {
  const rows: JourneyRow[] = [];
  const totals: Record<string, number> = {};
  let ol = 0, leads = 0, total = 0;
  for (const c of list) {
    if (category.length && !category.includes(c.category)) continue;
    if (city.length && !city.includes(c.city)) continue;
    const cols: Record<string, number> = {};
    let rOl = 0, rTotal = 0;
    for (const [s, v] of Object.entries(c.stages)) {
      const cnt = n(v);
      rTotal += cnt;
      if (s === OL_STAGE) { rOl += cnt; continue; }
      const k = COL_OF.get(s) ?? "other";
      cols[k] = (cols[k] || 0) + cnt;
    }
    if (rTotal === 0 && c.leads === 0) continue;
    for (const [k, v] of Object.entries(cols)) totals[k] = (totals[k] || 0) + v;
    ol += rOl; leads += c.leads; total += rTotal;
    rows.push({ name: c.name, city: c.cityList[0] === NO_CITY ? "" : c.city, leads: c.leads, total: rTotal, cols, ol: rOl });
  }
  rows.sort((a, b) => b.total - a.total || b.leads - a.leads || a.name.localeCompare(b.name));
  return { rows, totals, ol, leads, total, hasOther: (totals.other || 0) > 0 };
}

// ───────────────────────────── KPI drill-downs ─────────────────────────────

export type DrillKind = "lead" | "application" | "enrollment";
/** Same maths as the KPI cards: leads in the period; applications paid in the period; enrolments in the period. */
export function drillRows(students: PerfStudent[], visible: Set<string>, kind: DrillKind): PerfStudent[] {
  return students.filter((s) => {
    if (!visible.has(lower(s.consultant_name))) return false;
    if (kind === "lead") return s.via === "utm" && s.in_lead_window;
    if (kind === "application") return s.in_pay_window;
    return s.is_enrolled && s.in_enr_window;
  });
}
export const lower = (s: string) => s.trim().toLowerCase();

/** Leads in the view that have no application paid in the period → the "Lead Stage (not paid)" bucket. */
export function unpaidLeads(students: PerfStudent[], visible: Set<string>): PerfStudent[] {
  return drillRows(students, visible, "lead").filter((s) => !s.in_pay_window);
}

export type StageCount = { stage: string; n: number; pct: number };
export const LEAD_STAGE = "__lead_stage__";
/** Applications by stage, most first; the not-paid leads first. Percent of (applications + not-paid leads). */
export function stageBreakdown(apps: PerfStudent[], unpaid: number): StageCount[] {
  const m = new Map<string, number>();
  for (const r of apps) m.set(r.stage || "no_application", (m.get(r.stage || "no_application") || 0) + 1);
  const denom = apps.length + unpaid || 1;
  const list = Array.from(m.entries()).map(([stage, c]) => ({ stage, n: c, pct: (c / denom) * 100 }))
    .sort((a, b) => b.n - a.n || stageLabel(a.stage).localeCompare(stageLabel(b.stage)));
  return unpaid > 0 ? [{ stage: LEAD_STAGE, n: unpaid, pct: (unpaid / denom) * 100 }, ...list] : list;
}

/** Consultant drill: stage counts in pipeline order. */
export function stageCounts(students: PerfStudent[]): [string, number][] {
  const m = new Map<string, number>();
  for (const s of students) m.set(s.stage || "no_application", (m.get(s.stage || "no_application") || 0) + 1);
  return Array.from(m.entries()).sort((a, b) => stageRank(a[0]) - stageRank(b[0]) || a[0].localeCompare(b[0]));
}

// ───────────────────────────── dates (India time) ─────────────────────────────

export type DateRange = { start: string | null; end: string | null };
export const ALL_TIME: DateRange = { start: null, end: null };
export function todayIST(now = new Date()): string {
  return new Date(now.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
}
export const monthStartIST = (now = new Date()) => todayIST(now).slice(0, 7) + "-01";
export type Preset = "all" | "today" | "mtd" | "custom";
export function activePreset(r: DateRange, now = new Date()): Preset {
  if (!r.start && !r.end) return "all";
  const t = todayIST(now);
  if (r.start === t && r.end === t) return "today";
  if (r.start === monthStartIST(now) && r.end === t) return "mtd";
  return "custom";
}
/** Request body for the RPCs: only the keys that are set. */
export function windowParams(r: DateRange, campus: string | null): Record<string, string> {
  const p: Record<string, string> = {};
  if (r.start) p.start = r.start;
  if (r.end) p.end = r.end;
  if (campus) p.campus = campus;
  return p;
}

// ───────────────────────────── formatting ─────────────────────────────

export const fmtNum = (v: number) => Number(v || 0).toLocaleString("en-IN");
export const fmtINR = (v: number) => `₹${Math.round(Number(v || 0)).toLocaleString("en-IN")}`;
export const csvDate = (d = new Date()) => todayIST(d);
