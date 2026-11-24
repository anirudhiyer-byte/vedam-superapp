/**
 * VSAT pipeline grid · column catalogue helpers (migration 0097).
 *
 * The database decides which columns exist and who may see them (vsat_grid_columns /
 * vsat_grid_list). These helpers only give the columns readable names, pick the default set
 * for each panel, format cell values and turn pasted search text into values.
 */
import { PANEL_STAGES, STAGE_LABEL, STATUS_LABEL, isStage, isStatus, fmtIst, type PanelKey, type Stage } from "@/lib/vsat/pipeline";
import { ATTENDANCE_LABEL, MEET_LABEL, isMeetState } from "@/lib/vsat/interviews";

export type GridColType = "text" | "num" | "bool" | "date" | "ts" | "stage" | "status" | "json" | "uuid";
/** `filterable` comes from the database (0135): real columns of a filterable type, plus the virtual ones it has a fixed expression for. */
export type GridColumn = { key: string; group: string; type: GridColType; virtual: boolean; restricted: boolean; filterable?: boolean };
export type GridColumnsResult = { can_manage: boolean; columns: GridColumn[] };

export type GridRow = Record<string, unknown> & { application_id: string; stage: Stage; status: string; attempt_no: number };
export type GridFacets = {
  stage: Record<string, number>; status: Record<string, number>; vsat: Record<string, number>; campus: Record<string, number>;
  form_stage?: Record<string, number>; payment_stage?: Record<string, number>;
  /** 0140: students per interviewer user id ("none" = no interviewer), and each id's name. */
  interviewer?: Record<string, number>; interviewer_name?: Record<string, string>;
  /** 0158: the same for counsellors (Counselling panel). */
  counsellor?: Record<string, number>; counsellor_name?: Record<string, string>;
};
/** 0140: the Interviewer dropdown's value for "no interviewer yet". */
export const NO_INTERVIEWER = "none";
/** 0158: the Counsellor dropdown's value for "no counsellor yet". */
export const NO_COUNSELLOR = "none";

/**
 * Options for a people dropdown (Interviewer 0140, Counsellor 0158): everyone in the panel's scope by name, A–Z, then
 * the "nobody yet" option. A chosen person stays listed even when no row has them now. Counts are null before the
 * first load (facets not there yet).
 */
export function peopleOptions(
  names: Record<string, string> | undefined, counts: Record<string, number> | undefined, chosen: string[],
  opts: { none: string; noneLabel: string; fallback: string; loaded: boolean },
): { value: string; label: string; count: number | null }[] {
  const n = names ?? {}, c = counts ?? {};
  const ids = new Set([...Object.keys(n), ...chosen.filter((v) => v !== opts.none)]);
  const list = [...ids].map((id) => ({ value: id, label: n[id] ?? opts.fallback, count: opts.loaded ? c[id] ?? 0 : null }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [...list, { value: opts.none, label: opts.noneLabel, count: opts.loaded ? c[opts.none] ?? 0 : null }];
}
export type GridResult = { total: number; facets: GridFacets | null; rows: GridRow[]; limit: number; offset: number; can_manage: boolean };
export type GridSearch = { column: string; values: string[] };

/** Form-stage dimension (application_manager.form_stage_1 — enum vm_form_stage), in flow order. Any VSAT role may filter. */
export const FORM_STAGES = ["not_started", "form_initiated", "basic_details", "academic_details", "parent_details", "documents_uploaded", "form_submitted"] as const;
export const FORM_STAGE_LABEL: Record<string, string> = {
  not_started: "Not started", form_initiated: "Form initiated", basic_details: "Basic details", academic_details: "Academic details",
  parent_details: "Parent details", documents_uploaded: "Documents uploaded", form_submitted: "Form submitted",
};
/** Payment-stage dimension (application_manager.payment_stage_1 — enum vm_payment_stage). Admin / admissions only. */
export const PAYMENT_STAGES = ["payment_not_initiated", "payment_initiated", "payment_approved", "payment_failed"] as const;
export const PAYMENT_STAGE_LABEL: Record<string, string> = {
  payment_not_initiated: "Not initiated", payment_initiated: "Payment initiated", payment_approved: "Payment approved", payment_failed: "Payment failed",
};

/** Advanced filter builder (0118, 0135): AND-ed clauses on real columns and on the virtual ones the database can filter. Mirrors the operators it allows per type. */
export type FilterArity = "one" | "two" | "list" | "none";
export type FilterOp = { op: string; label: string; arity: FilterArity };
export type FilterClause = { column: string; op: string; v?: string | string[] };
/** Column types the advanced filter builder offers. */
export const FILTERABLE_TYPES = ["num", "date", "ts", "text", "bool"];
/** May this column go into the filter builder? The database says so (0135); older responses fall back to "real column of a filterable type". */
export const isFilterable = (c: GridColumn): boolean => c.filterable ?? (!c.virtual && FILTERABLE_TYPES.includes(c.type));

/** Columns whose values are a short fixed list: the filter builder offers a picker and cells show the readable word. */
export const VALUE_CHOICES: Record<string, { value: string; label: string }[]> = {
  proctoring: [{ value: "disqualified", label: "Disqualified" }, { value: "cleared", label: "Cleared" }],
  class12_result: [{ value: "pass", label: "Pass" }, { value: "fail", label: "Fail" }, { value: "yet_to_graduate", label: "Yet to graduate" }],
  payment_stage_1: PAYMENT_STAGES.map((v) => ({ value: v, label: PAYMENT_STAGE_LABEL[v] })),
  payment_stage_2: PAYMENT_STAGES.map((v) => ({ value: v, label: PAYMENT_STAGE_LABEL[v] })),
  // enum vm_attendance, same words as the student drawer (0140)
  interview_attendance: Object.entries(ATTENDANCE_LABEL).map(([value, label]) => ({ value, label })),
  counselling_attendance: Object.entries(ATTENDANCE_LABEL).map(([value, label]) => ({ value, label })),
};
const choiceLabel = (key: string, v: string): string => VALUE_CHOICES[key]?.find((c) => c.value === v)?.label ?? v;
export const FILTER_OPS: Record<string, FilterOp[]> = {
  num: [
    { op: "eq", label: "=", arity: "one" }, { op: "ne", label: "≠", arity: "one" },
    { op: "lt", label: "<", arity: "one" }, { op: "lte", label: "≤", arity: "one" },
    { op: "gt", label: ">", arity: "one" }, { op: "gte", label: "≥", arity: "one" },
    { op: "between", label: "between", arity: "two" }, { op: "in", label: "is any of", arity: "list" },
    { op: "notnull", label: "is set", arity: "none" }, { op: "isnull", label: "is empty", arity: "none" },
  ],
  date: [
    { op: "eq", label: "on", arity: "one" }, { op: "before", label: "before", arity: "one" }, { op: "after", label: "after", arity: "one" },
    { op: "between", label: "between", arity: "two" }, { op: "notnull", label: "is set", arity: "none" }, { op: "isnull", label: "is empty", arity: "none" },
  ],
  ts: [
    { op: "before", label: "before", arity: "one" }, { op: "after", label: "after", arity: "one" },
    { op: "between", label: "between", arity: "two" }, { op: "notnull", label: "is set", arity: "none" }, { op: "isnull", label: "is empty", arity: "none" },
  ],
  text: [
    { op: "contains", label: "contains", arity: "one" }, { op: "eq", label: "is", arity: "one" }, { op: "ne", label: "is not", arity: "one" },
    { op: "in", label: "is any of", arity: "list" }, { op: "notnull", label: "is set", arity: "none" }, { op: "isnull", label: "is empty", arity: "none" },
  ],
  bool: [
    { op: "true", label: "is Yes", arity: "none" }, { op: "false", label: "is No", arity: "none" },
    { op: "notnull", label: "is set", arity: "none" }, { op: "isnull", label: "is empty", arity: "none" },
  ],
};
export const opArity = (type: string, op: string): FilterArity => FILTER_OPS[type]?.find((o) => o.op === op)?.arity ?? "one";
export const opLabel = (type: string, op: string): string => FILTER_OPS[type]?.find((o) => o.op === op)?.label ?? op;
/** HTML input type for a filter value field, from the column type. */
export const filterInputType = (type: string): string => (type === "num" ? "number" : type === "date" || type === "ts" ? "date" : "text");
/** One filter clause → a short human string for the active-filter chips. */
export function describeClause(c: FilterClause, type: string): string {
  const name = columnLabel(c.column);
  const lab = opLabel(type, c.op);
  if (c.op === "isnull" || c.op === "notnull" || c.op === "true" || c.op === "false") return `${name} ${lab}`;
  if (c.op === "between" && Array.isArray(c.v)) return `${name} ${lab} ${c.v[0] ?? ""}–${c.v[1] ?? ""}`;
  if (c.op === "in" && Array.isArray(c.v)) return `${name} ${lab} ${c.v.map((v) => choiceLabel(c.column, v)).join(", ")}`;
  return `${name} ${lab} ${typeof c.v === "string" ? choiceLabel(c.column, c.v) : ""}`.trim();
}

/** Order the groups appear in the "Columns" drawer. Unknown groups go last, alphabetically. */
export const GROUP_ORDER = [
  "Pipeline", "Personal", "Academics", "JEE & entrance", "Olympiads", "Coding exams", "Parents", "Application",
  "Exam", "Interview", "Counselling", "Offer", "Payment", "Documents", "Marketing",
];

/** Readable names where the column name alone would not do. Everything else is humanised. */
const LABELS: Record<string, string> = {
  registered_name: "Student", application_no: "App no.", registered_email: "Email", registered_mobile: "Mobile",
  campus: "Campus", campus_applied: "Campus applied (as typed)", vsat: "VSAT", stage: "Stage", status: "Status",
  stage_changed_at: "Updated", attempt_no: "Attempt", current_attempt: "Attempt (old field)",
  payment_stage_1: "Payment status", payment_stage_2: "Payment status (attempt 2)",
  exam_percentile: "Percentile", exam_given: "Exam given", exam_obtained_marks: "Exam marks", exam_max_marks: "Exam max marks",
  exam_overall: "Result (Wheebox)", exam_assigned: "Exam assigned", vps_score: "VPS (stored)",
  vps_effective: "VPS", vps_override: "VPS override", vps_calculated: "VPS (calculated)",
  eligible_effective: "Eligible", eligible_override: "Eligible override",
  exam_percentage: "Exam %", exam_section_maths: "Maths", exam_section_lr: "Logical reasoning", exam_section_cs: "CS",
  proctoring: "Proctoring", class12_result: "12th result", class10_eligible: "10th eligible", class12_eligible: "12th eligible",
  interviewer: "Interviewer", interview_slot: "Interview slot (IST)", interview_attendance: "Interview status",
  interview_score: "Interview score", interview_calc_verdict: "Verdict (calculated)", interviewer_verdict: "Verdict (interviewer)",
  interview_meet: "Interview Meet", counselling_meet: "Counselling Meet",
  cheating_seen: "Cheating seen",
  counsellor: "Counsellor", counselling_slot: "Counselling slot (IST)", counselling_attendance: "Counselling status",
  interview_reschedules: "Interview reschedules", counselling_reschedules: "Counselling reschedules",
  counselling_category: "Scholarship category", counselling_pct: "Scholarship %", counselling_calculated_pct: "Calculated %",
  class10_percentage: "Class 10 %", class12_percentage: "Class 12 %", class10_maths_percentage: "Class 10 maths %",
  class12_maths_percentage: "Class 12 maths %", class10_year: "Class 10 year", class12_year: "Class 12 year",
  class10_board: "Class 10 board", class12_board: "Class 12 board", class10_school: "Class 10 school", class12_school: "Class 12 school",
  class10_score: "Class 10 score", class12_score: "Class 12 score", class10_maths_score: "Class 10 maths score", class12_maths_score: "Class 12 maths score",
  class10_marking_scheme: "Class 10 marking scheme", class12_marking_scheme: "Class 12 marking scheme",
  marks_physics_12: "Physics (12)", marks_chemistry_12: "Chemistry (12)", marks_maths_12: "Maths (12)",
  studied_pcm: "Studied PCM", studied_cs: "Studied CS", cs_experience: "CS experience", pcm_eligible: "PCM eligible",
  jee_registered: "JEE registered", jee_appeared_when: "JEE appeared", jee_score: "JEE score",
  entrance_percentile: "JEE percentile", jee_main_maths_percentile: "JEE maths percentile", entrance_rank: "JEE rank",
  date_of_birth: "Date of birth", residing_city: "Residing city", class_12_stream: "Class 12 stream",
  preferred_engineering_specialization: "Preferred specialisation", current_education_level: "Education level",
  family_income: "Family income", father_name: "Father's name", father_mobile: "Father's mobile", father_email: "Father's email",
  father_occupation: "Father's occupation", father_title: "Father's title", mother_name: "Mother's name", mother_mobile: "Mother's mobile",
  mother_email: "Mother's email", mother_occupation: "Mother's occupation", mother_title: "Mother's title",
  guardian_mobile_number: "Guardian's mobile", guardian_name: "Guardian's name", guardian_contact: "Guardian's contact",
  guardian_relationship: "Guardian's relationship", guardian_title: "Guardian's title",
  primary_utm: "UTM (first)", secondary_utm: "UTM (second)", tertiary_utm: "UTM (third)", latest_utm: "UTM (latest)",
  primary_utm_source: "UTM source (first)", primary_utm_medium: "UTM medium (first)", primary_utm_campaign: "UTM campaign (first)",
  wheebox_login_id: "Wheebox login", wheebox_registered: "Wheebox registered", form_completion_percentage: "Form completion %",
  offer_released_at: "Offer released (IST)", offer_expires_at: "Offer valid till (IST)", offer_cancelled: "Offer cancelled",
  offer_status: "Offer status", offer_released_date: "Offer released (old field)", offer_expiry_date: "Offer expiry (old field)",
  offer_pay_timeline_days: "Days to pay", scholarship_percentage: "Scholarship % (final)", scholarship_amount: "Scholarship amount",
  transferred_to_erp: "Transferred to ERP", doc_verification_status: "Documents verified", verification_level1_status: "Verification level 1",
};

const WORDS: Record<string, string> = {
  jee: "JEE", vsat: "VSAT", vps: "VPS", utm: "UTM", id: "ID", pcm: "PCM", cs: "CS", url: "URL", erp: "ERP", pct: "%",
  intl: "intl.", lr: "LR", class10: "Class 10", class12: "Class 12", dob: "DOB", pan: "PAN", aadhaar: "Aadhaar",
};

/** "class12_maths_percentage" → "Class 12 maths percentage". */
export function columnLabel(key: string): string {
  if (LABELS[key]) return LABELS[key];
  const words = key.split("_").filter(Boolean).map((w) => WORDS[w] ?? w);
  const s = words.join(" ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Default columns per panel — the ones the old panels showed. "registered_name" is always first and cannot be removed. */
export const DEFAULT_COLUMNS: Record<PanelKey, string[]> = {
  apps: ["registered_name", "campus", "vsat", "stage", "exam_percentile", "vps_effective", "eligible_effective", "stage_changed_at"],
  // 0135 — the results sheet: who, %, percentile, the three sections, VPS, eligibility and the proctoring verdict
  exam: ["registered_name", "campus", "gender", "vsat", "stage", "exam_percentage", "exam_percentile", "exam_section_maths", "exam_section_lr",
         "exam_section_cs", "vps_effective", "eligible_effective", "proctoring"],
  // 0140 — Meet state and attendance next to the slot; 0166 — status + reschedule count, no interviewer verdict
  intv: ["registered_name", "campus", "vsat", "stage", "interviewer", "interview_slot", "interview_meet", "interview_attendance", "interview_reschedules",
         "interview_score", "interview_calc_verdict", "stage_changed_at"],
  // 0144 — the offer deadline next to the scholarship; 0158 — the Meet state next to the slot; 0166 — status + reschedule count
  couns: ["registered_name", "campus", "vsat", "stage", "counsellor", "counselling_slot", "counselling_meet", "counselling_attendance",
          "counselling_reschedules", "counselling_category", "counselling_pct", "offer_expires_at", "stage_changed_at"],
};

/** Columns the request must carry for the shown ones to render (the override markers, the app no. under the name). */
export function requestColumns(shown: string[]): string[] {
  const out = new Set(shown);
  out.add("registered_name"); out.add("application_no");
  if (out.has("vps_effective")) { out.add("vps_override"); out.add("vps_calculated"); }
  if (out.has("eligible_effective")) out.add("eligible_override");
  return [...out];
}

/** Keep only columns the catalogue offers this person (a saved choice may include one they can no longer see). */
export function sanitizeColumns(saved: unknown, catalog: GridColumn[], fallback: string[]): string[] {
  const allowed = new Set(catalog.map((c) => c.key));
  const list = Array.isArray(saved) ? saved.filter((k): k is string => typeof k === "string" && allowed.has(k)) : [];
  const base = list.length ? list : fallback.filter((k) => allowed.has(k));
  return ["registered_name", ...base.filter((k) => k !== "registered_name")];
}

/** Pasted search text → distinct values (comma, semicolon, slash, tab or new line separated; 2–100 chars each; max 200). */
export function parseSearchValues(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of text.split(/[,;\t\n\r/]+/)) {
    const v = raw.trim();
    if (v.length >= 2 && v.length <= 100) seen.add(v);
    if (seen.size >= 200) break;
  }
  return [...seen];
}

/** Panel scope sent to the database (the Applications panel has none: every stage). */
export const panelScope = (panel: PanelKey): Stage[] | undefined => (panel === "apps" ? undefined : [...PANEL_STAGES[panel]]);

const istDate = (v: unknown) => (v ? new Date(String(v)).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "—");
const num = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : Number(v).toFixed(2).replace(/\.?0+$/, ""));

/** Plain-text value for a cell or a CSV field. */
export function formatValue(type: GridColType, key: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (type === "stage") return isStage(v) ? STAGE_LABEL[v] : String(v);
  if (type === "status") return isStatus(v) ? STATUS_LABEL[v] : String(v);
  if (type === "bool") return v === true ? "Yes" : v === false ? "No" : String(v);
  if (VALUE_CHOICES[key] && typeof v === "string") return choiceLabel(key, v);
  if (key === "interview_meet" || key === "counselling_meet") {
    if (v === "own_link") return "—";  // old pasted link: no "Own link" word anywhere (Google Meet only, 0167)
    return isMeetState(v) ? MEET_LABEL[v] : String(v);
  }
  if (type === "ts") return fmtIst(String(v));
  if (type === "date") return istDate(v);
  if (type === "num") return /_(pct|percentage)$/.test(key) ? `${num(v)}%` : num(v);
  if (Array.isArray(v)) return v.map(String).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** Rows → CSV text (labels as the header, every value quoted). */
export function toCsv(rows: GridRow[], cols: { key: string; type: GridColType }[]): string {
  const head = ["App no.", ...cols.filter((c) => c.key !== "application_no").map((c) => columnLabel(c.key))];
  const body = rows.map((r) => [
    String(r.application_no ?? r.application_id),
    ...cols.filter((c) => c.key !== "application_no").map((c) => { const s = formatValue(c.type, c.key, r[c.key]); return s === "—" ? "" : s; }),
  ]);
  return [head, ...body].map((line) => line.map((f) => `"${String(f ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
}

/** Facet dropdown summary: "All" / the one label / "3 selected". */
export function pickSummary(selected: string[], labelOf: (v: string) => string): string {
  if (selected.length === 0) return "All";
  if (selected.length === 1) return labelOf(selected[0]);
  return `${selected.length} selected`;
}

// ── 0165: the meeting link next to the Meet column (Join button) ─────────────

/** The key the grid sends the link under, next to each Meet column (only for staff who may join that meeting). */
export const MEET_LINK_KEY = { interview_meet: "interview_meet_link", counselling_meet: "counselling_meet_link" } as const;

/** The row's meeting link for a Meet column, or null. Only a well-formed https link is ever returned (never shown otherwise). */
export function meetLink(row: Record<string, unknown>, key: string): string | null {
  const k = (MEET_LINK_KEY as Record<string, string>)[key];
  const v = k ? row[k] : null;
  if (typeof v !== "string" || v.length > 500) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && !u.username && !u.password ? u.toString() : null;
  } catch {
    return null;
  }
}

/** "https://meet.google.com/abc-defg-hij" → "meet.google.com/abc-defg-hij" (shortened when long). */
export function linkText(url: string, max = 36): string {
  const s = url.replace(/^https:\/\//, "").replace(/\/$/, "");
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
