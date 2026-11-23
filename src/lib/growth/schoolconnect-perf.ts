/**
 * Growth → School Connect Channel → Performance (migration 0144) · pure helpers.
 *
 * The cards are the totals of the School Connect Listing rows (growth_sc_list, live numbers), narrowed by From / To
 * (Live Date), Campaign and Channel. The drill (growth_sc_perf_drill) lists the people behind a funnel step.
 *   Touchpoints = distinct UTM links · the funnel = Σ each step's column (In Window and All Time)
 *   Sign-up → Lead / Lead → Paid = conversion rates on the all-time totals
 */
import { csvCell } from "./consultants";
import type { ScRow } from "./schoolconnect";

export type ScDrillType = "signups" | "leads" | "applications" | "payments" | "enrollments";
export type ScDrillScope = "in_window" | "all_time";
export type ScDrill = { columns: string[]; students: Record<string, unknown>[]; total: number; truncated: boolean };

export type PerfFilter = { from: string; to: string; campaign: string; channel: string };
export const NO_PERF_FILTER: PerfFilter = { from: "", to: "", campaign: "", channel: "" };
export const anyPerfFilter = (f: PerfFilter) => !!(f.from || f.to || f.campaign || f.channel);
export const rangeError = (f: PerfFilter) => (f.from && f.to && f.from > f.to ? "From must be on or before To." : null);

/** From / To compare the Live Date (YYYY-MM-DD); Campaign and Channel are exact. */
export function filterPerfRows(rows: ScRow[], f: PerfFilter): ScRow[] {
  return rows.filter((r) => {
    const d = r.live_date ?? "";
    if (f.from && !(d && d >= f.from)) return false;
    if (f.to && !(d && d <= f.to)) return false;
    if (f.campaign && r.campaign !== f.campaign) return false;
    if (f.channel && r.channel !== f.channel) return false;
    return true;
  });
}

/** Dropdown values that exist in the rows, in natural order (VSAT-2 before VSAT-12). */
export function perfOptions(rows: ScRow[], key: "campaign" | "channel"): string[] {
  const seen = new Set<string>();
  for (const r of rows) { const v = r[key]; if (typeof v === "string" && v.trim()) seen.add(v.trim()); }
  return [...seen].sort((a, b) => a.localeCompare(b, "en", { numeric: true, sensitivity: "base" }));
}

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export type PerfKpis = {
  touchpoints: number;
  signupsWin: number; signupsAll: number; leadsWin: number; leadsAll: number;
  appsWin: number; appsAll: number; payWin: number; payAll: number; enrollments: number;
  s2l: number; l2p: number;
};
export function perfKpis(rows: ScRow[]): PerfKpis {
  const utms = new Set<string>();
  const k = { signupsWin: 0, signupsAll: 0, leadsWin: 0, leadsAll: 0, appsWin: 0, appsAll: 0, payWin: 0, payAll: 0, enrollments: 0 };
  for (const r of rows) {
    if (r.utm_link?.trim()) utms.add(r.utm_link.trim());
    k.signupsWin += n(r.signups); k.signupsAll += n(r.signups_all);
    k.leadsWin += n(r.leads); k.leadsAll += n(r.leads_all);
    k.appsWin += n(r.applications); k.appsAll += n(r.applications_all);
    k.payWin += n(r.payments); k.payAll += n(r.payments_all);
    k.enrollments += n(r.enrollments_all);
  }
  return {
    ...k, touchpoints: utms.size,
    s2l: k.signupsAll > 0 ? (k.leadsAll * 100) / k.signupsAll : 0,
    l2p: k.leadsAll > 0 ? (k.payAll * 100) / k.leadsAll : 0,
  };
}

export const fmtPct = (v: number) => (Number.isFinite(v) ? `${v.toFixed(1)}%` : "—");
export const fmtCount = (v: number) => n(v).toLocaleString("en-IN");

/** Request for the drill: the page's filters (the database narrows the rows the same way). */
export function drillParams(type: ScDrillType, scope: ScDrillScope, f: PerfFilter): Record<string, string> {
  const p: Record<string, string> = { type, scope };
  if (f.from) p.start = f.from;
  if (f.to) p.end = f.to;
  if (f.campaign) p.campaign = f.campaign;
  if (f.channel) p.channel = f.channel;
  return p;
}

// ───────────────────────────── drill table ─────────────────────────────

export const cellOf = (v: unknown): string => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** Search across every column, then each column's own filter (contains, any case). */
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
/** A new column sorts descending first, the same column flips. */
export const nextDrillSort = (s: DrillSort, col: string): DrillSort =>
  s && s.col === col ? { col, dir: s.dir === "asc" ? "desc" : "asc" } : { col, dir: "desc" };

/** Empty values last; numbers (and numeric text such as an ID) compare as numbers. */
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
  `school-connect-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase().replace(/^-|-$/g, "").slice(0, 40)}-${count}-rows.csv`;
