/**
 * Growth → Telegram Channel → Telegram Listing (migration 0132) · pure helpers.
 *
 * The database (growth_tg_list) returns the rows, the live attribution (in-window for the row's VSAT + all-time) and
 * the column list, and checks every value on save. These helpers only filter, sort, add up, format and convert:
 *   • CPL Spend = CPL × Leads (in-window) · CPA Spend = CPA × Payments (in-window) · Total Spend = CPL Spend + CPA Spend
 *   • Serial No is a counter (1…N) in list order, not a stored value (as on the CRM)
 *   • KPI cards follow the CRM Telegram Listing: unique influencers / UTMs, overall CPL / CPA, total spend,
 *     leads and payments (in-window, with all-time below), enrollments (all-time)
 */
import { tokenizeCsv } from "@/components/admin/communication/lib/csv-identifiers";
import { CSV_MAX_ROWS, csvCell, fmtDate, splitTerms, utmKey, type ConsColumn } from "./consultants";

export { CSV_MAX_ROWS, colKeyOf, fmtDate, utmKey } from "./consultants";

export type TgColumn = ConsColumn;
export type TgCampaign = { id: string; name: string; campaign_start: string | null; campaign_end: string | null };
export type TgRow = {
  id: string; influencer_name: string; utm_link: string; campaign_id: string; used_in: string | null; cpl: number; cpa: number;
  extra: Record<string, string>; created_at: string; updated_at: string; deleted_at: string | null; utm_key: string | null;
  leads: number; payments: number; enrollments: number; leads_all: number; payments_all: number; enrollments_all: number;
};
export type TgList = { rows: TgRow[]; counts: { active: number; trash: number }; columns: TgColumn[]; campaigns: TgCampaign[] };

/** Columns the team can type (row dialog, bulk update, CSV). Serial No, the spends and the counts are worked out. */
export const EDITABLE_STD = ["influencer_name", "utm_link", "used_in", "cpl", "cpa"] as const;
export const isSystem = (c: TgColumn) => c.standard;
export const isDraggable = (c: TgColumn) => !c.hidden;

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
export const cplSpend = (r: TgRow) => num(r.cpl) * num(r.leads);
export const cpaSpend = (r: TgRow) => num(r.cpa) * num(r.payments);
export const totalSpend = (r: TgRow) => cplSpend(r) + cpaSpend(r);

export function serialsOf(rows: TgRow[]): Map<string, number> {
  return new Map(rows.map((r, i) => [r.id, i + 1]));
}

/** The value of a column for a row (standard, computed or added). */
export function valueOf(r: TgRow, key: string, serial?: number): string | number | null {
  switch (key) {
    case "serial_no": return serial ?? null;
    case "cpl_spend": return cplSpend(r);
    case "cpa_spend": return cpaSpend(r);
    case "total_spend": return totalSpend(r);
    case "leads": case "payments": case "enrollments": case "leads_all": case "payments_all": case "enrollments_all": return num(r[key]);
    case "cpl": case "cpa": return num(r[key]) || null;   // CRM: an empty CPL / CPA shows "—"
    case "influencer_name": case "utm_link": case "used_in": return r[key] ?? null;
    default: {
      const v = r.extra?.[key];
      return v === undefined || v === "" ? null : v;
    }
  }
}

// ───────────────────────────── search / sort ─────────────────────────────

/** CRM search fields: influencer, UTM, VSAT (Used In), serial. Comma = any of several terms. */
export function filterRows(rows: TgRow[], q: string, serials: Map<string, number>): TgRow[] {
  const terms = splitTerms(q);
  if (!terms.length) return rows;
  return rows.filter((r) => {
    const hay = [r.influencer_name, r.utm_link, r.used_in, serials.get(r.id)].map((v) => (v == null ? "" : String(v).toLowerCase()));
    return terms.some((t) => hay.some((h) => h.includes(t)));
  });
}

export type Sort = { key: string; dir: "asc" | "desc" } | null;
/** Header click: none → ascending → descending → none (CRM order). */
export function nextSort(s: Sort, key: string): Sort {
  if (!s || s.key !== key) return { key, dir: "asc" };
  return s.dir === "asc" ? { key, dir: "desc" } : null;
}
export function sortRows(rows: TgRow[], s: Sort, serials: Map<string, number>): TgRow[] {
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

// ───────────────────────────── KPI cards (CRM Telegram Listing) ─────────────────────────────

export type TgKpis = {
  influencers: number; utms: number; overallCpl: number; overallCpa: number; totalSpend: number; cplSpend: number; cpaSpend: number;
  leads: number; leadsAll: number; payments: number; paymentsAll: number; enrollmentsAll: number;
};
export function kpis(rows: TgRow[]): TgKpis {
  const inf = new Set<string>(), utms = new Set<string>();
  const k: TgKpis = { influencers: 0, utms: 0, overallCpl: 0, overallCpa: 0, totalSpend: 0, cplSpend: 0, cpaSpend: 0,
    leads: 0, leadsAll: 0, payments: 0, paymentsAll: 0, enrollmentsAll: 0 };
  for (const r of rows) {
    const i = r.influencer_name.trim().toLowerCase(); if (i) inf.add(i);
    const u = r.utm_link.trim().toLowerCase(); if (u) utms.add(u);
    k.leads += num(r.leads); k.leadsAll += num(r.leads_all);
    k.payments += num(r.payments); k.paymentsAll += num(r.payments_all);
    k.enrollmentsAll += num(r.enrollments_all);
    k.cplSpend += cplSpend(r); k.cpaSpend += cpaSpend(r);
  }
  k.influencers = inf.size; k.utms = utms.size;
  k.totalSpend = k.cplSpend + k.cpaSpend;
  k.overallCpl = k.leads > 0 ? k.cplSpend / k.leads : 0;
  k.overallCpa = k.payments > 0 ? k.cpaSpend / k.payments : 0;
  return k;
}

// ───────────────────────────── formatting ─────────────────────────────

export const fmtInt = (v: number | null | undefined) => (v == null || !Number.isFinite(Number(v)) ? "—" : Math.round(Number(v)).toLocaleString("en-IN"));
/** CRM cards: ₹ with 2 decimals (₹0.00). */
export const fmtInr2 = (v: number | null | undefined) =>
  v == null || !Number.isFinite(Number(v)) ? "—" : `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Text in a cell (links and the via-UTM counts are drawn by the page). Amounts: ₹ and Indian grouping, as the CRM. */
export function cellText(c: TgColumn, v: string | number | null): string {
  if (v === null || v === "") return "—";
  if (c.key === "serial_no") return String(v);
  if (["cpl", "cpa", "cpl_spend", "cpa_spend", "total_spend"].includes(c.key)) return `₹${Number(v).toLocaleString("en-IN")}`;
  if (c.type === "number" || c.type === "computed") return Number.isFinite(Number(v)) ? Number(v).toLocaleString("en-IN") : String(v);
  if (c.type === "date") return fmtDate(String(v));
  return String(v);
}

// ───────────────────────────── duplicate check (same UTM in the same VSAT) ─────────────────────────────

export function duplicateOf(rows: TgRow[], link: string, campaign: string, selfId?: string): TgRow | null {
  const l = link.trim().toLowerCase();
  if (!l || !campaign) return null;
  const k = utmKey(link);
  return rows.find((r) => r.id !== selfId && (r.campaign_id === campaign || (r.used_in ?? "").toLowerCase() === campaign.toLowerCase())
    && (r.utm_link.trim().toLowerCase() === l || (k !== null && utmKey(r.utm_link) === k))) ?? null;
}

// ───────────────────────────── CSV export ─────────────────────────────

export function toCsv(rows: TgRow[], columns: TgColumn[], serials: Map<string, number>): string {
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
  "influencer": "influencer_name", "influencer name": "influencer_name", "name": "influencer_name", "channel": "influencer_name",
  "utm": "utm_link", "utm link": "utm_link", "link": "utm_link", "url": "utm_link",
  "used in": "used_in", "vsat": "used_in", "campaign": "used_in",
  "cpl": "cpl", "cost per lead": "cpl", "cpa": "cpa", "cost per acquisition": "cpa", "cost per payment": "cpa",
};
export type CsvParsed = { headers: string[]; records: string[][]; guess: string[] };
export const importTargets = (columns: TgColumn[]) => columns.filter((c) => c.type !== "computed");

export function parseCsv(text: string, columns: TgColumn[]): { ok: true; data: CsvParsed } | { ok: false; error: string } {
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

export function mapRecords(p: CsvParsed, mapping: string[], columns: TgColumn[]): Record<string, unknown>[] {
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

/** Mapping problems to fix before uploading. Matching needs UTM Link and Used In (one row per UTM per VSAT). */
export function mappingErrors(mapping: string[], columns: TgColumn[], mode: "add" | "upsert"): string[] {
  const errs: string[] = [];
  const seen = new Map<string, number>();
  mapping.forEach((k) => { if (k) seen.set(k, (seen.get(k) ?? 0) + 1); });
  const label = (k: string) => columns.find((c) => c.key === k)?.label ?? k;
  for (const [k, n] of seen) if (n > 1) errs.push(`${label(k)} is chosen for ${n} headers.`);
  if (!seen.has("utm_link")) errs.push(`Map a header to ${label("utm_link")} (it is needed for every row).`);
  if (!seen.has("used_in")) errs.push(`Map a header to ${label("used_in")} (the VSAT, needed for every row).`);
  if (mode === "add") {
    for (const c of columns) if (c.required && c.type !== "computed" && !seen.has(c.key) && c.key !== "utm_link" && c.key !== "used_in") errs.push(`Map a header to ${c.label} (required).`);
  }
  return errs;
}

// ───────────────────────────── errors ─────────────────────────────

const FIELD: Record<string, string> = {
  influencer_name: "Influencer Name", utm_link: "UTM Link", used_in: "Used In", cpl: "CPL", cpa: "CPA", label: "Column name",
};

export function tgError(raw: string | null | undefined, detail?: string | null, labelOf: (k: string) => string | undefined = () => undefined): string {
  const m = (raw ?? "").trim();
  const name = (k: string) => labelOf(k) ?? FIELD[k] ?? k.replace(/^x_/, "").replace(/_/g, " ");
  let x = /^REQUIRED: ([a-z0-9_]+)$/.exec(m);
  if (x) return `${name(x[1])} is required.`;
  x = /^BAD_VALUE: ([a-z0-9_]+)$/.exec(m);
  if (x) {
    const k = x[1];
    if (k === "utm_link") return `${name(k)} must be a full link starting with http:// or https://.`;
    if (k === "used_in") return `${name(k)} must be one of the VSAT campaigns (Growth → Campaigns).`;
    if (k === "cpl" || k === "cpa") return `${name(k)} must be a number of 0 or more.`;
    if (k === "type") return "Pick Text, Number, Date or URL.";
    if (k === "keys") return "The column order changed in the meantime. Reload the page and try again.";
    if (k === "key") return "That column cannot be changed this way.";
    return `${name(k)} has a value that is not allowed.`;
  }
  x = /^UNKNOWN_KEY: ([a-z0-9_]+)$/.exec(m);
  if (x) return x[1].startsWith("x_") ? "One of the columns was removed. Reload the page and try again." : "This request has a field the database does not accept.";
  switch (m) {
    case "DUPLICATE_UTM":
      return `This UTM is already listed for this VSAT${detail ? ` (${detail})` : ""}. A UTM can be listed once per VSAT — a second row would double-count.`;
    case "FORBIDDEN": return "Only admins can use the Telegram screens.";
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
    return list.map((e) => `Line ${e.row + 1}: ${tgError(e.error, null, labelOf)}`);
  } catch {
    return [];
  }
}
