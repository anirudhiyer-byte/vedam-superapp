/**
 * Growth → Vedantu Channel → Vedantu Performance (migration 0137) · pure helpers.
 *
 * As the vedamcrm360 Vedantu Performance page: the cards are the totals of the Vedantu Listing rows (growth_vd_list, live
 * numbers), narrowed by From / To (Live Date), Campaign and Channel. The drill (growth_vd_perf_drill) lists the people.
 *   Total unique videos = distinct Live Links · Total UTM = distinct UTM Links · Total views = Σ Actual Views
 *   Total spend = Σ (Video Spend + CPA × Payments all-time) · CPL = spend ÷ Leads all-time · CPP = spend ÷ Payments all-time
 *   L2P = Payments all-time ÷ Leads all-time × 100
 */
import { csvCell } from "./consultants";
import { totalSpend, type VdRow } from "./vedantu";

export type VdDrillType = "leads" | "payments" | "enrollments";
export type VdDrillScope = "in_window" | "all_time";
export type VdDrill = { columns: string[]; students: Record<string, unknown>[]; total: number; truncated: boolean };

export type PerfFilter = { from: string; to: string; campaign: string; channel: string };
export const NO_PERF_FILTER: PerfFilter = { from: "", to: "", campaign: "", channel: "" };
export const anyPerfFilter = (f: PerfFilter) => !!(f.from || f.to || f.campaign || f.channel);
export const rangeError = (f: PerfFilter) => (f.from && f.to && f.from > f.to ? "From must be on or before To." : null);

/** CRM: From / To compare the Live Date (YYYY-MM-DD); Campaign and Channel are exact. */
export function filterPerfRows(rows: VdRow[], f: PerfFilter): VdRow[] {
  return rows.filter((r) => {
    const d = r.live_date ?? "";
    if (f.from && !(d && d >= f.from)) return false;
    if (f.to && !(d && d <= f.to)) return false;
    if (f.campaign && r.campaign !== f.campaign) return false;
    if (f.channel && r.channel !== f.channel) return false;
    return true;
  });
}

/** Dropdown values that exist in the rows, in natural order (VSAT-2 before VSAT-12; the CRM sorted as text). */
export function perfOptions(rows: VdRow[], key: "campaign" | "channel"): string[] {
  const seen = new Set<string>();
  for (const r of rows) { const v = r[key]; if (typeof v === "string" && v.trim()) seen.add(v.trim()); }
  return [...seen].sort((a, b) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" }));
}

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export type PerfKpis = {
  uniqueVideos: number; uniqueUtms: number; totalViews: number; totalSpend: number; cpl: number; cpp: number;
  leadsWin: number; leadsAll: number; payWin: number; payAll: number; enrollments: number; l2p: number;
};
export function perfKpis(rows: VdRow[]): PerfKpis {
  const videos = new Set<string>(), utms = new Set<string>();
  const k = { totalViews: 0, totalSpend: 0, leadsWin: 0, leadsAll: 0, payWin: 0, payAll: 0, enrollments: 0 };
  for (const r of rows) {
    if (r.live_link?.trim()) videos.add(r.live_link.trim());
    if (r.utm_link?.trim()) utms.add(r.utm_link.trim());
    k.totalViews += n(r.actual_views);
    k.totalSpend += totalSpend(r);
    k.leadsWin += n(r.leads); k.leadsAll += n(r.leads_all);
    k.payWin += n(r.payments); k.payAll += n(r.payments_all);
    k.enrollments += n(r.enrollments_all);
  }
  return {
    ...k, uniqueVideos: videos.size, uniqueUtms: utms.size,
    cpl: k.leadsAll > 0 ? k.totalSpend / k.leadsAll : 0,
    cpp: k.payAll > 0 ? k.totalSpend / k.payAll : 0,
    l2p: k.leadsAll > 0 ? (k.payAll * 100) / k.leadsAll : 0,
  };
}

/** CRM card amounts: ₹x.xxCr / ₹x.xL / ₹x.xK, else ₹ with Indian grouping; 0 → ₹0. */
export function fmtShortInr(v: number): string {
  const x = n(v);
  if (!x) return "₹0";
  if (x >= 1e7) return `₹${(x / 1e7).toFixed(2)}Cr`;
  if (x >= 1e5) return `₹${(x / 1e5).toFixed(1)}L`;
  if (x >= 1e3) return `₹${(x / 1e3).toFixed(1)}K`;
  return `₹${x.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}
export const fmtPct = (v: number) => (Number.isFinite(v) ? `${v.toFixed(2)}%` : "—");
export const fmtCount = (v: number) => n(v).toLocaleString("en-IN");

/** Request for the drill: the page's filters (the database narrows the rows the same way). */
export function drillParams(type: VdDrillType, scope: VdDrillScope, f: PerfFilter): Record<string, string> {
  const p: Record<string, string> = { type, scope };
  if (f.from) p.start = f.from;
  if (f.to) p.end = f.to;
  if (f.campaign) p.campaign = f.campaign;
  if (f.channel) p.channel = f.channel;
  return p;
}

// ───────────────────────────── drill table ─────────────────────────────

export const cellOf = (v: unknown): string => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** CRM drill: search across every column, then each column's own filter (contains, any case). */
export function filterDrill(rows: Record<string, unknown>[], q: string, colFilters: Record<string, string>): Record<string, unknown>[] {
  let out = rows;
  const s = q.trim().toLowerCase();
  if (s) out = out.filter((r) => Object.values(r).some((v) => cellOf(v).toLowerCase().includes(s)));
  for (const [c, raw] of Object.entries(colFilters)) {
    const f = raw.trim().toLowerCase();
    if (f) out = out.filter((r) => cellOf(r[c]).toLowerCase().includes(f));
  }
  return out;
}

export type DrillSort = { col: string; dir: "asc" | "desc" } | null;
/** CRM: a new column sorts descending first, the same column flips. */
export const nextDrillSort = (s: DrillSort, col: string): DrillSort =>
  s && s.col === col ? { col, dir: s.dir === "asc" ? "desc" : "asc" } : { col, dir: "desc" };

/** Empty values last; numbers (and numeric text such as an ID) compare as numbers (the CRM compared them as text). */
export function sortDrill(rows: Record<string, unknown>[], s: DrillSort): Record<string, unknown>[] {
  if (!s) return rows;
  const d = s.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[s.col], y = b[s.col];
    const ex = x === null || x === undefined || x === "", ey = y === null || y === undefined || y === "";
    if (ex && ey) return 0;
    if (ex) return 1;
    if (ey) return -1;
    return cellOf(x).localeCompare(cellOf(y), "en", { numeric: true, sensitivity: "base" }) * d;
  });
}

export const DRILL_PAGE = 50;

/** Formula-safe CSV of what the drill shows (UTF-8 BOM added on download). */
export function drillCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const lines = [columns.map((c) => csvCell(c)).join(",")];
  for (const r of rows) lines.push(columns.map((c) => csvCell(r[c] === null || r[c] === undefined ? null : cellOf(r[c]))).join(","));
  return lines.join("\r\n");
}
export const drillFileName = (label: string, count: number) =>
  `vedantu-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase().replace(/^-|-$/g, "").slice(0, 40)}-${count}-rows.csv`;
