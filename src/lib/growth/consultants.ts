/**
 * Growth → Consultants Channel → Consultant Listing (migration 0130) · pure helpers.
 *
 * The database (growth_cons_list) returns the rows, the live attribution and the column list, and checks every
 * value on save. These helpers only filter, sort, add up, format and convert what it returned:
 *   • Total Enrollments = Enrollments (UTM) + Enrollments (Coupon); Total Spend = Enrollment Spend + Sunstone Slab Spend
 *   • Serial No is a counter (1…N) in list order, not a stored value (as on the CRM)
 *   • KPI cards are worked out from the rows that pass the filters (as on the CRM)
 */
import { tokenizeCsv } from "@/components/admin/communication/lib/csv-identifiers";

export const CATEGORIES = ["Associated with Sunstone", "Not Associated with Sunstone"] as const;
export const SLAB_VALUES = ["Yes", "No"] as const;
export type ConsColType = "text" | "number" | "date" | "url" | "select" | "computed";

export type ConsColumn = { key: string; label: string; type: ConsColType; required: boolean; standard: boolean; hidden: boolean };
export type ConsRow = {
  id: string; consultant_name: string; utm_link: string; city: string | null; bdm: string | null; category: string;
  coupon_code: string | null; slab_hit: string | null; enrollment_spend: number; slab_spend: number; extra: Record<string, string>;
  created_at: string; updated_at: string; deleted_at: string | null; utm_key: string | null;
  leads: number; apps_utm: number; apps_coupon: number; enr_utm: number; enr_coupon: number;
};
export type ConsList = { rows: ConsRow[]; counts: { active: number; trash: number }; columns: ConsColumn[] };

/** Columns the team can type (row dialog, bulk update). Serial No and the counts are worked out. */
export const EDITABLE_STD = ["consultant_name", "utm_link", "city", "bdm", "category", "coupon_code", "slab_hit", "enrollment_spend", "slab_spend"] as const;
/** System columns: rename / hide only (as on the CRM: serial and the link). Every CRM column is a system column here. */
export const isSystem = (c: ConsColumn) => c.standard;
/** Draggable = a visible column that is not worked out (CRM: computed / hidden columns are not draggable). */
export const isDraggable = (c: ConsColumn) => !c.hidden && c.type !== "computed";
/** Combo fields: pick an existing value or type a new one. */
export const COMBO_KEYS = new Set(["consultant_name", "bdm", "city"]);
export const MONEY_KEYS = new Set(["enrollment_spend", "slab_spend", "total_spend"]);
export const NUMBER_RIGHT = new Set(["leads", "apps_utm", "apps_coupon", "enr_utm", "enr_coupon", "enr_total", "enrollment_spend", "slab_spend", "total_spend"]);

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
export const totalEnrollments = (r: ConsRow) => num(r.enr_utm) + num(r.enr_coupon);
export const totalSpend = (r: ConsRow) => num(r.enrollment_spend) + num(r.slab_spend);

/** Serial No: 1…N in the order the list came from the database (newest change first), like the CRM counter. */
export function serialsOf(rows: ConsRow[]): Map<string, number> {
  return new Map(rows.map((r, i) => [r.id, i + 1]));
}

/** The value of a column for a row (standard, computed or added). */
export function valueOf(r: ConsRow, key: string, serial?: number): string | number | null {
  switch (key) {
    case "serial_no": return serial ?? null;
    case "enr_total": return totalEnrollments(r);
    case "total_spend": return totalSpend(r);
    case "leads": case "apps_utm": case "apps_coupon": case "enr_utm": case "enr_coupon":
    case "enrollment_spend": case "slab_spend": return num(r[key]);
    case "consultant_name": case "utm_link": case "city": case "bdm": case "category": case "coupon_code": case "slab_hit":
      return r[key] ?? null;
    default: {
      const v = r.extra?.[key];
      return v === undefined || v === "" ? null : v;
    }
  }
}

// ───────────────────────────── search / filters / sort ─────────────────────────────

/** "a, b" → ["a","b"] (comma = several values, any of them). */
export function splitTerms(q: string): string[] {
  return q.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
}

export type Filters = { q: string; category: string; slab: "" | "yes" | "no" };

/** CRM search fields: consultant, UTM, coupon, category, city, BDM, serial. */
export function filterRows(rows: ConsRow[], f: Filters, serials: Map<string, number>): ConsRow[] {
  const terms = splitTerms(f.q);
  return rows.filter((r) => {
    if (f.category && r.category !== f.category) return false;
    if (f.slab === "yes" && r.slab_hit !== "Yes") return false;
    if (f.slab === "no" && r.slab_hit !== "No") return false;
    if (!terms.length) return true;
    const hay = [r.consultant_name, r.utm_link, r.coupon_code, r.category, r.city, r.bdm, serials.get(r.id)]
      .map((v) => (v == null ? "" : String(v).toLowerCase()));
    return terms.some((t) => hay.some((h) => h.includes(t)));
  });
}

export type Sort = { key: string; dir: "asc" | "desc" } | null;
/** Header click: none → ascending → descending → none (CRM order). */
export function nextSort(s: Sort, key: string): Sort {
  if (!s || s.key !== key) return { key, dir: "asc" };
  return s.dir === "asc" ? { key, dir: "desc" } : null;
}

export function sortRows(rows: ConsRow[], s: Sort, serials: Map<string, number>): ConsRow[] {
  if (!s) return rows;
  const d = s.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = valueOf(a, s.key, serials.get(a.id)), y = valueOf(b, s.key, serials.get(b.id));
    if (x == null && y == null) return 0;
    if (x == null) return 1;   // empty cells last either way
    if (y == null) return -1;
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "en-IN", { numeric: true, sensitivity: "base" });
    return c * d;
  });
}

// ───────────────────────────── KPI cards ─────────────────────────────

export type ConsKpis = {
  consultants: number; associated: number; notAssociated: number; active: number; leads: number;
  apps: number; appsUtm: number; appsCoupon: number; enr: number; enrUtm: number; enrCoupon: number;
  enrollmentSpend: number; slabSpend: number; totalSpend: number;
};

/** Consultants are counted once by name (any case); their category is the first non-empty one in the list. */
export function kpis(rows: ConsRow[]): ConsKpis {
  const cat = new Map<string, string>();
  const active = new Set<string>();
  const k: ConsKpis = { consultants: 0, associated: 0, notAssociated: 0, active: 0, leads: 0, apps: 0, appsUtm: 0, appsCoupon: 0,
    enr: 0, enrUtm: 0, enrCoupon: 0, enrollmentSpend: 0, slabSpend: 0, totalSpend: 0 };
  for (const r of rows) {
    const name = r.consultant_name.trim().toLowerCase();
    if (name) {
      if (!cat.has(name)) cat.set(name, "");
      if (r.category && !cat.get(name)) cat.set(name, r.category);
      if (num(r.leads) > 0 || num(r.apps_utm) + num(r.apps_coupon) > 0) active.add(name);
    }
    k.leads += num(r.leads);
    k.appsUtm += num(r.apps_utm); k.appsCoupon += num(r.apps_coupon);
    k.enrUtm += num(r.enr_utm); k.enrCoupon += num(r.enr_coupon);
    k.enrollmentSpend += num(r.enrollment_spend); k.slabSpend += num(r.slab_spend);
  }
  k.consultants = cat.size;
  for (const c of cat.values()) {
    if (c === "Associated with Sunstone") k.associated++;
    else k.notAssociated++;
  }
  k.active = active.size;
  k.apps = k.appsUtm + k.appsCoupon;
  k.enr = k.enrUtm + k.enrCoupon;
  k.totalSpend = k.enrollmentSpend + k.slabSpend;
  return k;
}

// ───────────────────────────── formatting ─────────────────────────────

export const fmtInt = (v: number | null | undefined) => (v == null || !Number.isFinite(Number(v)) ? "—" : Math.round(Number(v)).toLocaleString("en-IN"));
export const fmtInr = (v: number | null | undefined) => (v == null || !Number.isFinite(Number(v)) ? "—" : `₹${Math.round(Number(v)).toLocaleString("en-IN")}`);
export function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  if (!m) return d;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

/** Text shown in a cell (links are drawn by the page). */
export function cellText(c: ConsColumn, v: string | number | null): string {
  if (v === null || v === "") return "—";
  if (c.key === "serial_no") return String(v);
  if (MONEY_KEYS.has(c.key)) return fmtInr(Number(v));
  if (c.type === "number" || c.type === "computed") return Number.isFinite(Number(v)) ? Number(v).toLocaleString("en-IN") : String(v);
  if (c.type === "date") return fmtDate(String(v));
  return String(v);
}

// ───────────────────────────── UTM (same rule as growth__utm_key, for the live duplicate check) ─────────────────────────────

function utmParam(link: string, key: string): string | null {
  const m = new RegExp(`[?&]${key}=([^&#]+)`).exec(link);
  if (!m) return null;
  const v = m[1].replace(/\+/g, " ").replace(/%20/g, " ").trim();
  return v || null;
}
/** source/medium/campaign of a link, lower-cased and trimmed (null when it has none). */
export function utmKey(link: string): string | null {
  const parts = ["utm_source", "utm_medium", "utm_campaign"].map((k) => utmParam(link, k)).filter((x): x is string => !!x);
  if (!parts.length) return null;
  return parts.join("/").split("/").map((s) => s.trim().toLowerCase()).join("/");
}
/** The live row (other than `selfId`) that already uses this link. The database checks this again on save. */
export function duplicateOf(rows: ConsRow[], link: string, selfId?: string): ConsRow | null {
  const l = link.trim().toLowerCase();
  if (!l) return null;
  const k = utmKey(link);
  return rows.find((r) => r.id !== selfId && (r.utm_link.trim().toLowerCase() === l || (k !== null && utmKey(r.utm_link) === k))) ?? null;
}

// ───────────────────────────── CSV export ─────────────────────────────

/** One CSV cell; text that a spreadsheet would run as a formula gets a leading apostrophe. */
export function csvCell(v: string | number | null): string {
  if (v === null) return "";
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The filtered rows as CSV: every column in table order (hidden ones too), then values of removed columns. */
export function toCsv(rows: ConsRow[], columns: ConsColumn[], serials: Map<string, number>): string {
  const known = new Set(columns.map((c) => c.key));
  const extraKeys = [...new Set(rows.flatMap((r) => Object.keys(r.extra ?? {})))].filter((k) => !known.has(k)).sort();
  const head = [...columns.map((c) => c.label), ...extraKeys];
  const lines = [head.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push([...columns.map((c) => valueOf(r, c.key, serials.get(r.id))), ...extraKeys.map((k) => r.extra?.[k] ?? null)].map(csvCell).join(","));
  }
  return lines.join("\r\n");
}

export const csvFileName = (d = new Date()) =>
  `consultants-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.csv`;

// ───────────────────────────── CSV upload ─────────────────────────────

export const CSV_MAX_ROWS = 2000;
const norm = (h: string) => h.trim().toLowerCase().replace(/[_\-.()*#:]+/g, " ").replace(/\s+/g, " ").trim();
const ALIASES: Record<string, string> = {
  "consultant": "consultant_name", "consultant name": "consultant_name", "name": "consultant_name",
  "utm": "utm_link", "utm link": "utm_link", "link": "utm_link", "url": "utm_link",
  "city": "city", "bdm": "bdm", "category": "category",
  "coupon": "coupon_code", "coupon code": "coupon_code",
  "slab hit": "slab_hit", "sunstone slab hit": "slab_hit",
  "enrollment spend": "enrollment_spend", "enrolment spend": "enrollment_spend",
  "slab spend": "slab_spend", "sunstone slab spend": "slab_spend",
};

export type CsvParsed = { headers: string[]; records: string[][]; guess: string[] };

/** File text → headers, data records and a first guess of the column for every header ("" = skip). */
export function parseCsv(text: string, columns: ConsColumn[]): { ok: true; data: CsvParsed } | { ok: false; error: string } {
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

/** Columns a file can fill: every typed column (not Serial No or the counts). */
export const importTargets = (columns: ConsColumn[]) => columns.filter((c) => c.type !== "computed");

/** Records + chosen mapping → rows for growth_cons_import. Empty cells are left out (upsert keeps the old value). */
export function mapRecords(p: CsvParsed, mapping: string[], columns: ConsColumn[]): Record<string, unknown>[] {
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

/** Mapping problems the user must fix before uploading. */
export function mappingErrors(mapping: string[], columns: ConsColumn[], mode: "add" | "upsert"): string[] {
  const errs: string[] = [];
  const seen = new Map<string, number>();
  mapping.forEach((k) => { if (k) seen.set(k, (seen.get(k) ?? 0) + 1); });
  for (const [k, n] of seen) if (n > 1) errs.push(`${columns.find((c) => c.key === k)?.label ?? k} is chosen for ${n} headers.`);
  if (!seen.has("utm_link")) errs.push("Map a header to UTM Link (it is needed for every row).");
  if (mode === "add") {
    for (const c of columns) if (c.required && c.type !== "computed" && !seen.has(c.key)) errs.push(`Map a header to ${c.label} (required).`);
  }
  return errs;
}

// ───────────────────────────── errors ─────────────────────────────

const FIELD: Record<string, string> = {
  consultant_name: "Consultant Name", utm_link: "UTM Link", city: "City", bdm: "BDM", category: "Category", coupon_code: "Coupon Code",
  slab_hit: "Sunstone Slab Hit", enrollment_spend: "Enrollment Spend", slab_spend: "Sunstone Slab Spend", label: "Column name",
};

/** Database error code (+ detail) → a sentence for the banner. `labelOf` gives the current label of a column key. */
export function consError(raw: string | null | undefined, detail?: string | null, labelOf: (k: string) => string | undefined = () => undefined): string {
  const m = (raw ?? "").trim();
  const name = (k: string) => labelOf(k) ?? FIELD[k] ?? k.replace(/^x_/, "").replace(/_/g, " ");
  let x = /^REQUIRED: ([a-z0-9_]+)$/.exec(m);
  if (x) return `${name(x[1])} is required.`;
  x = /^BAD_VALUE: ([a-z0-9_]+)$/.exec(m);
  if (x) {
    const k = x[1];
    if (k === "utm_link") return `${name(k)} must be a full link starting with http:// or https://.`;
    if (k === "category") return `${name(k)} must be "Associated with Sunstone" or "Not Associated with Sunstone".`;
    if (k === "slab_hit") return `${name(k)} must be Yes or No.`;
    if (k === "enrollment_spend" || k === "slab_spend") return `${name(k)} must be a number of 0 or more.`;
    if (k === "type") return "Pick Text, Number, Date or URL.";
    if (k === "keys") return "The column order changed in the meantime. Reload the page and try again.";
    if (k === "key") return "That column cannot be changed this way.";
    return `${name(k)} has a value that is not allowed.`;
  }
  x = /^UNKNOWN_KEY: ([a-z0-9_]+)$/.exec(m);
  if (x) return x[1].startsWith("x_") ? "One of the columns was removed. Reload the page and try again." : "This request has a field the database does not accept.";
  switch (m) {
    case "DUPLICATE_UTM":
      return `This UTM is already used by ${detail ? detail : "another row"}. Each UTM must be unique — duplicate UTMs cause double-counting.`;
    case "FORBIDDEN": return "Only admins can use the Consultants screens.";
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

/** IMPORT_FAILED detail ("[{row, error}]") → lines; file line = row + 1 (the header is line 1). */
export function importErrorLines(detail: string | null | undefined, labelOf: (k: string) => string | undefined): string[] {
  try {
    const list = JSON.parse(detail ?? "") as { row: number; error: string }[];
    if (!Array.isArray(list)) return [];
    return list.map((e) => `Line ${e.row + 1}: ${consError(e.error, null, labelOf)}`);
  } catch {
    return [];
  }
}
