/**
 * VSAT Leads grid · column catalogue helpers (migration 0159).
 *
 * The database decides which lead columns exist and who may see them (vsat_leads_grid_columns /
 * vsat_leads_grid_list). These helpers give the columns readable names, pick the default set,
 * format cell values and turn pasted search text into values. The filter-operator machinery
 * (FILTER_OPS, opArity, …) is shared with the Applications grid and imported from ./grid.
 */
import {
  FILTER_OPS, VALUE_CHOICES, opArity, opLabel, filterInputType, isFilterable, parseSearchValues,
  type GridColType, type GridColumn, type FilterClause,
} from "@/lib/vsat/grid";

export type { GridColType, GridColumn, FilterClause };
export { FILTER_OPS, VALUE_CHOICES, opArity, opLabel, filterInputType, isFilterable, parseSearchValues };

export type LeadsColumnsResult = { can_manage: boolean; columns: GridColumn[] };
export type LeadRow = Record<string, unknown> & { lead_id: string; name?: unknown; email?: unknown; mobile?: unknown };
export type LeadsFacets = {
  campus: Record<string, number>; lead_stage: Record<string, number>;
  applied: { yes: number; no: number }; source: Record<string, number>;
};
export type LeadsResult = { total: number; facets: LeadsFacets | null; rows: LeadRow[]; limit: number; offset: number; can_manage: boolean };
export type GridSearch = { column: string; values: string[] };

/** The column that is always shown and cannot be removed. */
export const LEAD_NAME_COL = "registered_name";

/** Default columns — what the old Leads table showed. registered_name is always first. */
export const DEFAULT_LEAD_COLUMNS = [
  "registered_name", "registered_email", "registered_mobile", "campus", "lead_stage",
  "lead_source", "application_submitted", "primary_utm", "latest_utm", "user_registration_date",
];

/** Order the groups appear in the "Columns" drawer. Unknown groups go last, alphabetically. */
export const GROUP_ORDER = ["Lead", "Pipeline", "Marketing", "Academics", "Parents", "Ownership", "Activity", "Scoring", "Dates"];

/** Readable names where the column name alone would not do. Everything else is humanised. */
const LABELS: Record<string, string> = {
  registered_name: "Name", registered_email: "Email", registered_mobile: "Mobile", alternate_mobile: "Alternate mobile",
  whatsapp_number: "WhatsApp", campus: "Campus", campus_preference: "Campus (as typed)",
  lead_stage: "Stage", lead_sub_stage: "Sub-stage", lead_source: "Source", source_hearabout: "Heard about us",
  application_submitted: "Applied", form_initiated: "Form started", lead_status: "Lead status",
  primary_utm: "Primary campaign", secondary_utm: "Second campaign", tertiary_utm: "Third campaign", latest_utm: "Latest campaign",
  primary_utm_source: "UTM source", primary_utm_medium: "UTM medium", primary_utm_campaign: "UTM campaign",
  primary_attribution: "Primary attribution", latest_attribution: "Latest attribution",
  user_registration_date: "Joined", last_contacted_at: "Last contacted", next_followup_date: "Next follow-up",
  passing_year: "Passing year", class_12_stream: "Class 12 stream", school_name: "School", jee_percentile: "JEE percentile",
  current_education_level: "Education level", preferred_engineering_specialization: "Preferred specialisation",
  parent_name: "Parent's name", parent_phone: "Parent's phone", guardian_mobile_number: "Guardian's mobile",
  assigned_bdm: "BDM", assigned_caller: "Caller", lead_owner: "Lead owner", lead_score: "Lead score",
  lead_strength_percentile: "Lead strength %", date_of_birth: "Date of birth",
};

const WORDS: Record<string, string> = {
  utm: "UTM", jee: "JEE", id: "ID", url: "URL", bdm: "BDM", ip: "IP", class12: "Class 12", dob: "DOB", pcm: "PCM", cs: "CS",
};

/** "registration_channel" → "Registration channel". */
export function columnLabel(key: string): string {
  if (LABELS[key]) return LABELS[key];
  const words = key.split("_").filter(Boolean).map((w) => WORDS[w] ?? w);
  const s = words.join(" ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** lead_stage enum value → readable words ("applicant_paid" → "Applicant paid"). */
export const stageLabel = (v: unknown) =>
  v ? String(v).replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()) : "—";
export const campusLabel = (v: unknown) => (v === "pune" ? "Pune" : v === "gurugram" ? "Gurugram" : "—");

const istDate = (v: unknown) => (v ? new Date(String(v)).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "—");
const fmtIst = (v: unknown) => (v ? new Date(String(v)).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "—");
const num = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : Number(v).toFixed(2).replace(/\.?0+$/, ""));

/** Plain-text value for a cell or a CSV field. */
export function formatValue(type: GridColType, key: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (key === "campus") return campusLabel(v);
  if (key === "lead_stage" || key === "first_lead_stage" || key === "previous_lead_stage") return stageLabel(v);
  if (type === "bool") return v === true ? "Yes" : v === false ? "No" : String(v);
  if (type === "ts") return fmtIst(v);
  if (type === "date") return istDate(v);
  if (type === "num") return /_(pct|percentage|percentile)$/.test(key) ? `${num(v)}%` : num(v);
  if (Array.isArray(v)) return v.map(String).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** One filter clause → a short human string for the active-filter chips. */
export function describeClause(c: FilterClause, type: string): string {
  const name = columnLabel(c.column);
  const lab = opLabel(type, c.op);
  const choice = (v: string) => VALUE_CHOICES[c.column]?.find((o) => o.value === v)?.label ?? v;
  if (c.op === "isnull" || c.op === "notnull" || c.op === "true" || c.op === "false") return `${name} ${lab}`;
  if (c.op === "between" && Array.isArray(c.v)) return `${name} ${lab} ${c.v[0] ?? ""}–${c.v[1] ?? ""}`;
  if (c.op === "in" && Array.isArray(c.v)) return `${name} ${lab} ${c.v.map(choice).join(", ")}`;
  return `${name} ${lab} ${typeof c.v === "string" ? choice(c.v) : ""}`.trim();
}

/** Keep only columns the catalogue offers this person; registered_name is always first. */
export function sanitizeColumns(saved: unknown, catalog: GridColumn[], fallback: string[]): string[] {
  const allowed = new Set(catalog.map((c) => c.key));
  const list = Array.isArray(saved) ? saved.filter((k): k is string => typeof k === "string" && allowed.has(k)) : [];
  const base = list.length ? list : fallback.filter((k) => allowed.has(k));
  return [LEAD_NAME_COL, ...base.filter((k) => k !== LEAD_NAME_COL)];
}

/** Rows → CSV text (labels as the header, every value quoted). */
export function toCsv(rows: LeadRow[], cols: { key: string; type: GridColType }[]): string {
  const head = cols.map((c) => columnLabel(c.key));
  const body = rows.map((r) => cols.map((c) => { const s = formatValue(c.type, c.key, r[c.key]); return s === "—" ? "" : s; }));
  return [head, ...body].map((line) => line.map((f) => `"${String(f ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
}

/** Facet dropdown summary: "All" / the one label / "3 selected". */
export function pickSummary(selected: string[], labelOf: (v: string) => string): string {
  if (selected.length === 0) return "All";
  if (selected.length === 1) return labelOf(selected[0]);
  return `${selected.length} selected`;
}

const KEY = "vsat_leads_cols";
/** Remember the chosen columns on this device (per the Applications grid's pattern). */
export function loadCols(): string[] | null {
  try { const v = JSON.parse(localStorage.getItem(KEY) || "null"); return Array.isArray(v) ? v : null; } catch { return null; }
}
export function saveCols(cols: string[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(cols)); } catch { /* ignore */ }
}
