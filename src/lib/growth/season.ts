// Pure helpers for Growth → Overview → Season Dashboard. No UI and no network, so they can be unit-tested.
// The numbers come from growth_season_counts / growth_season_drill (migration 0108); the database checks
// the admin and every value again. Column keys here must match the keys the database returns.

import { errorText } from "./marketing";

export type DrillKind = "leads" | "paid" | "enrolled";
export type SortState = { col: string; dir: "asc" | "desc" } | null;
export type Col = { key: string; label: string };

/** Largest page the database serves (it also refuses anything above 100). */
export const DRILL_PAGE_SIZE = 50;
/** The Total Leads list pages 100 at a time (same as the CRM); the database allows up to 100. */
export const DRILL_PAGE_SIZE_LEADS = 100;
export const EXPORT_MAX_ROWS = 5000;

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date written as YYYY-MM-DD (2026-02-30 and 2026-1-1 are not). */
export function isIsoDate(s: string): boolean {
  const m = ISO.exec(s);
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** The admissions season starts on 20 Nov: that is the default "From". `today` is an IST date, YYYY-MM-DD. */
export function academicYearStart(today: string): string {
  const y = Number(today.slice(0, 4));
  const after = today.slice(5) >= "11-20";
  return `${after ? y : y - 1}-11-20`;
}

export type RangeCheck = { ok: true } | { ok: false; error: string };

export function validateRange(from: string, to: string): RangeCheck {
  if (!isIsoDate(from)) return { ok: false, error: "Pick a valid From date." };
  if (!isIsoDate(to)) return { ok: false, error: "Pick a valid To date." };
  if (from > to) return { ok: false, error: "The From date must be on or before the To date." };
  return { ok: true };
}

export type Search = { include: string[]; exclude: string[] };

/** "pune, delhi, !test": comma = many terms (any may match), "!" = leave out rows that match. Max 10 terms, 100 characters each. */
export function parseSearch(raw: string): Search {
  const out: Search = { include: [], exclude: [] };
  let n = 0;
  for (const part of (raw ?? "").split(",")) {
    if (n >= 10) break;
    let t = part.trim();
    const neg = t.startsWith("!");
    if (neg) t = t.slice(1).trim();
    if (!t) continue;
    t = t.slice(0, 100);
    (neg ? out.exclude : out.include).push(t);
    n++;
  }
  return out;
}

/** Click on a column header: newest/largest first → oldest/smallest first → back to the default order. */
export function nextSort(cur: SortState, col: string): SortState {
  if (!cur || cur.col !== col) return { col, dir: "desc" };
  return cur.dir === "desc" ? { col, dir: "asc" } : null;
}

export const pageCount = (total: number, size: number): number => Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, size)));

export function clampPage(page: number, total: number, size: number): number {
  const p = Number.isFinite(page) ? Math.floor(page) : 1;
  return Math.min(Math.max(1, p), pageCount(total, size));
}

const csvCell = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  let s = typeof v === "string" ? v : String(v);
  // a cell that starts with = + - @ (or a tab / return) would run as a formula in Excel / Sheets
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(cols: Col[], rows: Record<string, unknown>[]): string {
  const head = cols.map((c) => csvCell(c.label)).join(",");
  if (rows.length === 0) return head;
  return [head, ...rows.map((r) => cols.map((c) => csvCell(r[c.key])).join(","))].join("\r\n");
}

// ───────────────────────────── columns (same keys the database returns) ─────────────────────────────

const LEAD_COLUMNS: Col[] = [
  { key: "public_id", label: "Lead ID" }, { key: "name", label: "Name" }, { key: "email", label: "Email" }, { key: "phone", label: "Phone" },
  { key: "city", label: "City" }, { key: "state", label: "State" }, { key: "campus", label: "Campus preference" },
  { key: "education", label: "Education level" }, { key: "stream", label: "Class 12 stream" }, { key: "passing_year", label: "Passing year" },
  { key: "school", label: "School" }, { key: "source", label: "Lead source" }, { key: "utm_source", label: "UTM source" },
  { key: "utm_medium", label: "UTM medium" }, { key: "utm_campaign", label: "UTM campaign" }, { key: "channel", label: "Channel" },
  { key: "stage", label: "Lead stage" }, { key: "status", label: "Lead status" }, { key: "owner", label: "Lead owner" }, { key: "created", label: "Created (IST)" },
];

const APP_COLUMNS: Col[] = [
  { key: "public_id", label: "Lead ID" }, { key: "application_no", label: "Application no." }, { key: "name", label: "Name" },
  { key: "email", label: "Email" }, { key: "phone", label: "Phone" }, { key: "gender", label: "Gender" }, { key: "city", label: "City" },
  { key: "state", label: "State" }, { key: "campus", label: "Campus applied" }, { key: "program", label: "Program" },
  { key: "education", label: "Education level" }, { key: "stream", label: "Class 12 stream" }, { key: "class12_pct", label: "Class 12 %" },
  { key: "jee_percentile", label: "JEE percentile" }, { key: "form_status", label: "Form status" }, { key: "vsat_registered", label: "VSAT registered" },
  { key: "exam_date", label: "Exam date" }, { key: "exam_given", label: "Exam given" }, { key: "exam_percentile", label: "Exam percentile" },
  { key: "vps_score", label: "VPS score" }, { key: "scholarship_pct", label: "Scholarship %" }, { key: "offer_status", label: "Offer status" },
  { key: "paid_at", label: "Paid on (IST)" }, { key: "paid_amount", label: "Paid amount" }, { key: "payment_ref", label: "Payment ref" },
  { key: "enrollment_stage", label: "Enrolment stage" }, { key: "enrolled_at", label: "Enrolled on (IST)" }, { key: "enrollment_amount", label: "Enrolment amount" },
  { key: "utm_source", label: "UTM source" }, { key: "utm_medium", label: "UTM medium" }, { key: "utm_campaign", label: "UTM campaign" },
  { key: "owner", label: "Application owner" }, { key: "created", label: "Lead created (IST)" },
];

export const columnsFor = (k: DrillKind): Col[] => (k === "leads" ? LEAD_COLUMNS : APP_COLUMNS);

// ───────────────────────────── request builders ─────────────────────────────

export type CountsArgs = { from: string; to: string; campaignId: string };

/** A campaign locks the window, so dates are not sent with it. */
export function buildCountsPayload(a: CountsArgs): Record<string, unknown> {
  return a.campaignId ? { campaign_id: a.campaignId } : { from: a.from, to: a.to };
}

export type DrillArgs = {
  kind: DrillKind; from: string; to: string; campaignId: string; search: string; filters: Record<string, string>;
  sort: SortState; page: number; pageSize: number; exportAll?: boolean;
  /** Largest page size this call may ask for. Default DRILL_PAGE_SIZE; the Leads list passes DRILL_PAGE_SIZE_LEADS. */
  maxPageSize?: number;
};

export function buildDrillPayload(a: DrillArgs): Record<string, unknown> {
  const p: Record<string, unknown> = { kind: a.kind, ...buildCountsPayload(a) };
  const search = (a.search ?? "").trim();
  if (search) p.search = search;
  const filters: Record<string, string> = {};
  for (const [k, v] of Object.entries(a.filters ?? {})) {
    const t = (v ?? "").trim();
    if (t) filters[k] = t;
  }
  if (Object.keys(filters).length) p.filters = filters;
  if (a.sort) p.sort = { col: a.sort.col, dir: a.sort.dir };
  const page = Math.floor(a.page);
  p.page = Number.isFinite(page) && page >= 1 ? page : 1;
  const size = Math.floor(a.pageSize);
  const cap = Math.min(Math.max(1, Math.floor(a.maxPageSize ?? DRILL_PAGE_SIZE)), 100);
  p.page_size = Number.isFinite(size) ? Math.min(Math.max(1, size), cap) : Math.min(DRILL_PAGE_SIZE, cap);
  if (a.exportAll) p.export = true;
  return p;
}

// ───────────────────────────── errors ─────────────────────────────

/** Database code → one plain sentence. Unknown text is never shown (it could name tables or functions). */
export function seasonError(raw: string | null | undefined): string {
  const m = (raw ?? "").trim();
  if (m === "FORBIDDEN") return "Only admins can open the Season Dashboard.";
  if (/^(BAD_VALUE|REQUIRED|UNKNOWN_KEY): [a-z0-9_]+$/.test(m) || m === "NOT_SIGNED_IN" || m === "NOT_FOUND") return errorText(m);
  return "Something went wrong. Please try again.";
}

export type Counts = { leads: number; paid: number; enrolled: number; from: string | null; to: string | null; locked: boolean; campaign: string | null };
export type DrillResult = { total: number; page: number; page_size: number; rows: Record<string, unknown>[]; truncated?: boolean };
