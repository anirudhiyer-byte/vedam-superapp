import { errorText } from "./marketing";

/**
 * Growth → Overview → Payment Cohort: the pure parts (request, matrix, labels, texts).
 * The day counts and the window come from public.growth_cohort_report (migration 0117); "today" (IST) is decided there.
 * Matrix maths follow the CRM page app/(app)/cohort/page.tsx: one row per lead day, one column per pay day,
 * plus a "Before {from}" row, an "Unknown lead date" row and (owner's choice) an "After {to}" row so totals reconcile.
 */

export const MAX_RANGE_DAYS = 120;

export type DayCount = { d: string; n: number };
export type Cell = { l: string; p: string; n: number };
export type PayCount = { p: string; n: number };
export type CohortReport = {
  from: string;
  to: string;
  today: string;
  locked: boolean;
  source: "campaign" | "custom" | "default";
  campaign: { id: string; name: string } | null;
  leads: DayCount[];
  cells: Cell[];
  before: PayCount[];
  before_days: number;
  after: PayCount[];
  after_days: number;
  unknown: PayCount[];
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY_MS = 86_400_000;

/** Days since 1970 for a real calendar date (YYYY-MM-DD), else null. No local timezone is involved. */
function dayNumber(iso: unknown): number | null {
  if (typeof iso !== "string" || !ISO_RE.test(iso)) return null;
  const [y, m, d] = iso.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return null;
  return Math.round(t / DAY_MS);
}

function isoOf(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** Every day from → to, both included. Bad, reversed or longer than 120 days → [] (never a huge loop). */
export function dayList(from: string, to: string): string[] {
  const a = dayNumber(from);
  const b = dayNumber(to);
  if (a === null || b === null || b < a || b - a + 1 > MAX_RANGE_DAYS) return [];
  const out: string[] = [];
  for (let d = a; d <= b; d++) out.push(isoOf(d));
  return out;
}

/** "19 Nov 2026" (CRM fmtFull). */
export function fmtFull(iso: string): string {
  if (dayNumber(iso) === null) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** "19 Nov" (CRM fmtShort). */
export function fmtShort(iso: string): string {
  if (dayNumber(iso) === null) return "—";
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

/** "3" (CRM fmtDay, column header). */
export function fmtDay(iso: string): string {
  if (dayNumber(iso) === null) return "—";
  return String(Number(iso.slice(8, 10)));
}

/** CRM heat: alpha = 0.12 + (n / max) × 0.55; 0 means no colour. */
export function heatAlpha(n: number, max: number): number {
  if (!(n > 0) || !(max > 0)) return 0;
  return 0.12 + Math.min(n / max, 1) * 0.55;
}

/** CRM: Paid ÷ Leads × 100, one decimal; 0 leads → "0.0". */
export function conversion(paid: number, leads: number): string {
  if (!(leads > 0) || !(paid >= 0) || !Number.isFinite(paid) || !Number.isFinite(leads)) return "0.0";
  return ((paid / leads) * 100).toFixed(1);
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

export type MatrixRow = {
  kind: "before" | "unknown" | "day" | "after";
  key: string;
  label: string;
  sub?: string;
  title?: string;
  /** leads registered that day; null for the bucket rows (CRM shows "·") */
  leads: number | null;
  /** one count per pay day, same order as `days` */
  cells: number[];
  total: number;
  /** the lead day for day rows (for the same-day ring) */
  day?: string;
};

export type Matrix = {
  days: string[];
  rows: MatrixRow[];
  colTotals: number[];
  grand: number;
  totalLeads: number;
  maxCell: number;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The table the page draws. Anything outside the window or not a positive whole number is dropped. */
export function buildMatrix(r: CohortReport | null): Matrix {
  const days = r ? dayList(r.from, r.to) : [];
  if (!r || days.length === 0) return { days: [], rows: [], colTotals: [], grand: 0, totalLeads: 0, maxCell: 0 };

  const at = new Map(days.map((d, i) => [d, i] as const));
  const list = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  let maxCell = 0;

  const leadsByDay = new Map<string, number>();
  for (const x of list<DayCount>(r.leads)) {
    if (!x || !at.has(x.d)) continue;
    leadsByDay.set(x.d, (leadsByDay.get(x.d) ?? 0) + num(x.n));
  }

  const grid = new Map<string, number[]>();
  for (const x of list<Cell>(r.cells)) {
    if (!x || !at.has(x.l) || !at.has(x.p)) continue;
    const n = num(x.n);
    if (n === 0) continue;
    const row = grid.get(x.l) ?? days.map(() => 0);
    row[at.get(x.p)!] += n;
    grid.set(x.l, row);
    maxCell = Math.max(maxCell, row[at.get(x.p)!]);
  }

  const bucket = (v: unknown): number[] => {
    const row = days.map(() => 0);
    for (const x of list<PayCount>(v)) {
      if (!x || !at.has(x.p)) continue;
      row[at.get(x.p)!] += num(x.n);
    }
    for (const n of row) maxCell = Math.max(maxCell, n);
    return row;
  };
  const sum = (a: number[]) => a.reduce((s, n) => s + n, 0);

  const rows: MatrixRow[] = [];
  const before = bucket(r.before);
  if (sum(before) > 0) {
    rows.push({ kind: "before", key: "before", label: `Before ${fmtShort(r.from)}`, sub: plural(num(r.before_days), "earlier lead day"),
      leads: null, cells: before, total: sum(before) });
  }
  const unknown = bucket(r.unknown);
  if (sum(unknown) > 0) rows.push({ kind: "unknown", key: "unknown", label: "Unknown lead date", leads: null, cells: unknown, total: sum(unknown) });
  for (const d of days) {
    const cells = grid.get(d) ?? days.map(() => 0);
    rows.push({ kind: "day", key: d, day: d, label: fmtShort(d), title: fmtFull(d), leads: leadsByDay.get(d) ?? 0, cells, total: sum(cells) });
  }
  const after = bucket(r.after);
  if (sum(after) > 0) {
    rows.push({ kind: "after", key: "after", label: `After ${fmtShort(r.to)}`, sub: plural(num(r.after_days), "later lead day"),
      leads: null, cells: after, total: sum(after) });
  }

  const colTotals = days.map((_, j) => rows.reduce((s, row) => s + row.cells[j], 0));
  let totalLeads = 0;
  for (const n of leadsByDay.values()) totalLeads += n;
  return { days, rows, colTotals, grand: sum(colTotals), totalLeads, maxCell };
}

/** The last part of the CRM summary bar ("VSAT-14 (campaign window)" / "custom range" / "last 30 days"). */
export function summarySource(r: CohortReport | null): string {
  if (!r) return "";
  if (r.source === "campaign" && r.campaign) return `${r.campaign.name} (campaign window)`;
  if (r.source === "default") return "last 30 days";
  return "custom range";
}

/** Campaign OR dates, never both. A bad id or bad / half dates → {} and the database opens its last 30 days. */
export function buildCohortPayload(a: { campaignId: string; from: string; to: string }): Record<string, string> {
  const id = (a.campaignId ?? "").trim().toLowerCase();
  if (UUID_RE.test(id)) return { campaign_id: id };
  if (dayNumber(a.from) !== null && dayNumber(a.to) !== null) return { from: a.from, to: a.to };
  return {};
}

export const RANGE_TOO_LONG = `Pick a range of ${MAX_RANGE_DAYS} days or less.`;

/** Screen check before asking the database (the database checks the same again). */
export function checkRange(from: string, to: string): { ok: true } | { ok: false; error: string } {
  const a = dayNumber(from);
  const b = dayNumber(to);
  if (a === null || b === null) return { ok: false, error: "Pick a valid From and To date." };
  if (b < a) return { ok: false, error: "The To date must be on or after the From date." };
  if (b - a + 1 > MAX_RANGE_DAYS) return { ok: false, error: RANGE_TOO_LONG };
  return { ok: true };
}

/** Database codes → plain sentences. Unknown text (a raw database error) is never shown. */
export function cohortError(raw: string | null | undefined, opts: { campaign?: boolean } = {}): string {
  const m = (raw ?? "").trim();
  if (m === "FORBIDDEN") return "Only admins can open the Payment Cohort.";
  if (m === "BAD_VALUE: range") {
    return opts.campaign
      ? `This campaign's window is longer than ${MAX_RANGE_DAYS} days, so it cannot be shown. Choose "Choose a campaign…" and pick dates instead.`
      : RANGE_TOO_LONG;
  }
  if (m === "NOT_FOUND") return "That campaign was not found. Pick another one.";
  if (/^(BAD_VALUE|UNKNOWN_KEY|REQUIRED): [a-z0-9_]+$/.test(m) || m === "NOT_SIGNED_IN" || m === "BAD_REQUEST") return errorText(m);
  return "Something went wrong. Please try again.";
}
