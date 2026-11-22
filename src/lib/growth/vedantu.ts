/**
 * Growth → Vedantu Channel → Vedantu Listing (migration 0136) · pure helpers.
 *
 * The database (growth_vd_list) returns the rows, their live attribution (in-window for the VSAT that holds the Live
 * Date + all-time) and the column list, and checks every value on save. These helpers only filter, sort, add up, format
 * and convert, the way the CRM's Vedantu Listing does:
 *   • Campaign = the VSAT whose dates hold the Live Date (worked out by the database, never typed)
 *   • Total CPA = CPA × Payments (all-time) · Total Spend = Video Spend + Total CPA
 *   • Enrollments column = all-time enrolments of the UTM (Leads / Payments have In Window and All Time columns)
 *   • Serial No is a counter (1…N) in Live Date order, not a stored value
 *   • View Comparison = (Actual − Expected) ÷ Expected, worked out on screen from the two view columns
 *   • KPI cards follow the filtered rows: Posts live, Total spend, Video spend, Total CPA spend, Total views
 */
import { tokenizeCsv } from "@/components/admin/communication/lib/csv-identifiers";
import { CSV_MAX_ROWS, csvCell, fmtDate, splitTerms, type ConsColumn } from "./consultants";

export { CSV_MAX_ROWS, colKeyOf, fmtDate } from "./consultants";

export type VdColumn = ConsColumn;
export type VdRow = {
  id: string; channel: string; live_link: string | null; utm_link: string; live_date: string;
  campaign_id: string | null; campaign: string | null;
  expected_views: number | null; actual_views: number | null; video_spend: number; cpa: number; notes: string | null;
  extra: Record<string, string>; created_at: string; updated_at: string; deleted_at: string | null; utm_key: string | null;
  leads: number; payments: number; enrollments: number; leads_all: number; payments_all: number; enrollments_all: number;
};
export type VdList = { rows: VdRow[]; counts: { active: number; trash: number }; columns: VdColumn[] };

/** Columns the team can type (row dialog, bulk update, CSV). Serial No, Campaign, the spends and the counts are worked out. */
export const EDITABLE_STD = ["channel", "live_link", "utm_link", "live_date", "expected_views", "actual_views", "video_spend", "cpa", "notes"] as const;
export const isSystem = (c: VdColumn) => c.standard;
/** CRM: a column can be dragged unless it is worked out (Serial No, Campaign, Total …, counts, View Comparison) or hidden. */
export const isDraggable = (c: VdColumn) => !c.hidden && c.type !== "computed";
export const VIEW_COMPARISON = "__view_comparison";

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
export const totalCpa = (r: VdRow) => num(r.cpa) * num(r.payments_all);
export const totalSpend = (r: VdRow) => num(r.video_spend) + totalCpa(r);

/** Serial No: a counter in Live Date order, oldest first (ties keep the list order). Not affected by sorts or filters. */
export function serialsOf(rows: VdRow[]): Map<string, number> {
  const order = rows.map((r, i) => ({ id: r.id, d: r.live_date ?? "", i }));
  order.sort((a, b) => (a.d === b.d ? a.i - b.i : a.d < b.d ? -1 : 1));
  return new Map(order.map((o, n) => [o.id, n + 1]));
}

export type Comparison = { kind: "fill" } | { kind: "none" } | { kind: "ok"; pct: number; abs: number };
/** CRM View Comparison: no Expected → "— (fill expected)"; no Actual → "—"; otherwise % and absolute difference. */
export function comparison(r: VdRow): Comparison {
  const e = r.expected_views, a = r.actual_views;
  if (e == null || !Number.isFinite(Number(e)) || Number(e) === 0) return { kind: "fill" };
  if (a == null || !Number.isFinite(Number(a))) return { kind: "none" };
  const abs = Number(a) - Number(e);
  return { kind: "ok", pct: (abs / Number(e)) * 100, abs };
}

/** The value of a column for a row (standard, computed or added). */
export function valueOf(r: VdRow, key: string, serial?: number): string | number | null {
  switch (key) {
    case "serial_no": return serial ?? null;
    case "campaign": return r.campaign ?? null;
    case "total_cpa": return totalCpa(r);
    case "total_spend": return totalSpend(r);
    case "leads": case "payments": case "leads_all": case "payments_all": case "enrollments_all": return num(r[key]);
    // CRM: the Listing's Enrollments column is all-time (its Performance card "Enrolments · All time" adds this column up)
    case "enrollments": return num(r.enrollments_all);
    case VIEW_COMPARISON: { const c = comparison(r); return c.kind === "ok" ? c.pct : null; }
    case "expected_views": case "actual_views": return r[key] == null ? null : num(r[key]);
    case "video_spend": case "cpa": return num(r[key]) || null;   // CRM: an empty spend / CPA shows "—"
    case "channel": case "live_link": case "utm_link": case "live_date": case "notes": return r[key] ?? null;
    default: {
      const v = r.extra?.[key];
      return v === undefined || v === "" ? null : v;
    }
  }
}

// ───────────────────────────── search / filters / sort ─────────────────────────────

export type Filters = { q: string; campaign: string; channel: string };
export const NO_FILTERS: Filters = { q: "", campaign: "", channel: "" };
export const anyFilter = (f: Filters) => !!(f.q || f.campaign || f.channel);

/** CRM search fields: channel, campaign, UTM, live link. Comma = any of several terms. Campaign and Channel dropdowns narrow further. */
export function filterRows(rows: VdRow[], f: Filters): VdRow[] {
  const terms = splitTerms(f.q);
  return rows.filter((r) => {
    if (f.campaign && r.campaign !== f.campaign) return false;
    if (f.channel && r.channel !== f.channel) return false;
    if (!terms.length) return true;
    const hay = [r.channel, r.campaign, r.utm_link, r.live_link].map((v) => (v == null ? "" : String(v).toLowerCase()));
    return terms.some((t) => hay.some((h) => h.includes(t)));
  });
}

/** The values in the Campaign / Channel dropdowns: those that exist in the rows, A → Z. */
export function optionsOf(rows: VdRow[], key: "campaign" | "channel"): string[] {
  const seen = new Set<string>();
  for (const r of rows) { const v = r[key]; if (typeof v === "string" && v.trim()) seen.add(v.trim()); }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

export type Sort = { key: string; dir: "asc" | "desc" } | null;
/** Header click: none → ascending → descending → none (CRM order). */
export function nextSort(s: Sort, key: string): Sort {
  if (!s || s.key !== key) return { key, dir: "asc" };
  return s.dir === "asc" ? { key, dir: "desc" } : null;
}
export function sortRows(rows: VdRow[], s: Sort, serials: Map<string, number>): VdRow[] {
  if (!s) return rows;
  const d = s.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = valueOf(a, s.key, serials.get(a.id)), y = valueOf(b, s.key, serials.get(b.id));
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "en-IN", { numeric: true, sensitivity: "base" });
    return c * d;
  });
}

// ───────────────────────────── KPI cards (CRM Vedantu Listing) ─────────────────────────────

export type VdKpis = { postsLive: number; totalSpend: number; videoSpend: number; totalCpaSpend: number; totalViews: number };
export function kpis(rows: VdRow[]): VdKpis {
  const k: VdKpis = { postsLive: rows.length, totalSpend: 0, videoSpend: 0, totalCpaSpend: 0, totalViews: 0 };
  for (const r of rows) {
    k.totalSpend += totalSpend(r); k.videoSpend += num(r.video_spend); k.totalCpaSpend += totalCpa(r); k.totalViews += num(r.actual_views);
  }
  return k;
}

// ───────────────────────────── formatting ─────────────────────────────

export const fmtInt = (v: number | null | undefined) => (v == null || !Number.isFinite(Number(v)) ? "—" : Math.round(Number(v)).toLocaleString("en-IN"));
/** CRM cards: ₹ with Indian grouping. */
export const fmtInr = (v: number | null | undefined) =>
  v == null || !Number.isFinite(Number(v)) ? "—" : `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** Text in a cell (links, View Comparison and the via-UTM counts are drawn by the page). Amounts are plain numbers, as the CRM. */
export function cellText(c: VdColumn, v: string | number | null): string {
  if (v === null || v === "") return "—";
  if (c.key === "serial_no") return String(v);
  if (c.type === "number" || c.type === "computed") return Number.isFinite(Number(v)) ? Number(v).toLocaleString("en-IN") : String(v);
  if (c.type === "date") return fmtDate(String(v));
  return String(v);
}

// ───────────────────────────── CSV export ─────────────────────────────

export function toCsv(rows: VdRow[], columns: VdColumn[], serials: Map<string, number>): string {
  const known = new Set(columns.map((c) => c.key));
  const extraKeys = [...new Set(rows.flatMap((r) => Object.keys(r.extra ?? {})))].filter((k) => !known.has(k)).sort();
  const head = [...columns.map((c) => c.label), ...extraKeys];
  const lines = [head.map(csvCell).join(",")];
  for (const r of rows) lines.push([...columns.map((c) => valueOf(r, c.key, serials.get(r.id))), ...extraKeys.map((k) => r.extra?.[k] ?? null)].map(csvCell).join(","));
  return lines.join("\r\n");
}

// ───────────────────────────── CSV upload ─────────────────────────────

const norm = (h: string) => h.trim().toLowerCase().replace(/[_\-.()*#:]+/g, " ").replace(/\s+/g, " ").trim();
const ALIASES: Record<string, string> = {
  "channel": "channel", "channel name": "channel", "influencer": "channel", "name": "channel",
  "live link": "live_link", "live url": "live_link", "video link": "live_link", "video url": "live_link", "youtube link": "live_link",
  "utm": "utm_link", "utm link": "utm_link", "utm url": "utm_link", "link": "utm_link", "url": "utm_link",
  "live date": "live_date", "date": "live_date", "published date": "live_date",
  "expected views": "expected_views", "expected": "expected_views",
  "actual views": "actual_views", "views": "actual_views", "actual": "actual_views",
  "video spend": "video_spend", "spend": "video_spend", "cost": "video_spend",
  "cpa": "cpa", "cost per acquisition": "cpa", "cost per payment": "cpa",
  "notes": "notes", "note": "notes", "remarks": "notes",
};
export type CsvParsed = { headers: string[]; records: string[][]; guess: string[] };
export const importTargets = (columns: VdColumn[]) => columns.filter((c) => c.type !== "computed");

export function parseCsv(text: string, columns: VdColumn[]): { ok: true; data: CsvParsed } | { ok: false; error: string } {
  const tok = tokenizeCsv(text);
  if (!Array.isArray(tok)) return { ok: false, error: tok.error };
  const recs = tok.filter((r) => r.some((c) => c.trim() !== ""));
  if (!recs.length || recs[0].every((h) => !h.trim())) return { ok: false, error: "No headers detected. First row must contain column names." };
  if (recs.length < 2) return { ok: false, error: "No data rows found." };
  if (recs.length - 1 > CSV_MAX_ROWS) return { ok: false, error: `The file has ${recs.length - 1} rows. Upload at most ${CSV_MAX_ROWS} at a time.` };
  const target = importTargets(columns);
  const byLabel = new Map(target.map((c) => [norm(c.label), c.key]));
  const used = new Set<string>();
  const guess = recs[0].map((h) => {
    const n = norm(h);
    const k = byLabel.get(n) ?? ALIASES[n] ?? (target.some((c) => c.key === n.replace(/ /g, "_")) ? n.replace(/ /g, "_") : "");
    if (!k || used.has(k)) return "";
    used.add(k);
    return k;
  });
  return { ok: true, data: { headers: recs[0].map((h) => h.trim()), records: recs.slice(1), guess } };
}

export function mapRecords(p: CsvParsed, mapping: string[], columns: VdColumn[]): Record<string, unknown>[] {
  const custom = new Set(columns.filter((c) => !c.standard).map((c) => c.key));
  return p.records.map((rec) => {
    const out: Record<string, unknown> = {};
    const extra: Record<string, string> = {};
    mapping.forEach((k, i) => {
      if (!k) return;
      const v = (rec[i] ?? "").trim();
      if (!v) return;
      if (custom.has(k)) extra[k] = v; else out[k] = v;
    });
    if (Object.keys(extra).length) out.extra = extra;
    return out;
  });
}

/**
 * Mapping problems to fix before uploading. Matching needs UTM Link (and uses Live Date's VSAT when the file has it).
 * Update mode can be a file with only UTM Link + the columns to change (e.g. Actual Views); Add mode needs every required column.
 */
export function mappingErrors(mapping: string[], columns: VdColumn[], mode: "add" | "upsert"): string[] {
  const errs: string[] = [];
  const seen = new Map<string, number>();
  mapping.forEach((k) => { if (k) seen.set(k, (seen.get(k) ?? 0) + 1); });
  const label = (k: string) => columns.find((c) => c.key === k)?.label ?? k;
  for (const [k, n] of seen) if (n > 1) errs.push(`${label(k)} is chosen for ${n} headers.`);
  if (!seen.has("utm_link")) errs.push(`Map a header to ${label("utm_link")} (it is needed for every row).`);
  if (mode === "add") {
    for (const c of columns) if (c.required && c.type !== "computed" && !seen.has(c.key) && c.key !== "utm_link") errs.push(`Map a header to ${c.label} (required).`);
  }
  return errs;
}

// ───────────────────────────── errors ─────────────────────────────

const FIELD: Record<string, string> = {
  channel: "Channel", live_link: "Live Link", utm_link: "UTM Link", live_date: "Live Date", expected_views: "Expected Views",
  actual_views: "Actual Views", video_spend: "Video Spend", cpa: "CPA", notes: "Notes", label: "Column name",
};

export function vdError(raw: string | null | undefined, detail?: string | null, labelOf: (k: string) => string | undefined = () => undefined): string {
  const m = (raw ?? "").trim();
  const name = (k: string) => labelOf(k) ?? FIELD[k] ?? k.replace(/^x_/, "").replace(/_/g, " ");
  let x = /^REQUIRED: ([a-z0-9_]+)$/.exec(m);
  if (x) return `${name(x[1])} is required.`;
  x = /^BAD_VALUE: ([a-z0-9_]+)$/.exec(m);
  if (x) {
    const k = x[1];
    if (k === "utm_link" || k === "live_link") return `${name(k)} must be a full link starting with http:// or https://.`;
    if (k === "live_date") return `${name(k)} must be a real date (YYYY-MM-DD or DD-MM-YYYY).`;
    if (k === "expected_views" || k === "actual_views" || k === "video_spend" || k === "cpa") return `${name(k)} must be a number of 0 or more.`;
    if (k === "type") return "Pick Text, Number, Date or URL.";
    if (k === "keys") return "The column order changed in the meantime. Reload the page and try again.";
    if (k === "key") return "That column cannot be changed this way.";
    return `${name(k)} has a value that is not allowed.`;
  }
  x = /^UNKNOWN_KEY: ([a-z0-9_]+)$/.exec(m);
  if (x) return x[1].startsWith("x_") ? "One of the columns was removed. Reload the page and try again." : "This request has a field the database does not accept.";
  switch (m) {
    case "DUPLICATE_UTM":
      return `This UTM is already listed in the same VSAT${detail ? ` (${detail})` : ""}. A UTM can be listed once per VSAT — a second row would double-count.`;
    case "FORBIDDEN": return "Only admins can use the Vedantu screens.";
    case "NOT_SIGNED_IN": return "Your session ended. Sign in again.";
    case "NOT_FOUND": return "It no longer exists (or is in the Trash). Reload the page.";
    case "DUPLICATE": return "A column with that name already exists.";
    case "SYSTEM_COLUMN": return "System column — it can only be renamed or hidden.";
    case "TOO_MANY_ROWS": return `Upload at most ${CSV_MAX_ROWS} rows at a time.`;
    case "TOO_MANY_COLUMNS": return "The table can have at most 30 added columns.";
    case "IMPORT_FAILED": return "Nothing was uploaded because some rows have errors.";
    case "BAD_REQUEST": return "The request was not valid.";
    default: return "Something went wrong. Please try again.";
  }
}

export function importErrorLines(detail: string | null | undefined, labelOf: (k: string) => string | undefined): string[] {
  try {
    const list = JSON.parse(detail ?? "") as { row: number; error: string }[];
    if (!Array.isArray(list)) return [];
    return list.map((e) => `Line ${e.row + 1}: ${vdError(e.error, null, labelOf)}`);
  } catch {
    return [];
  }
}
