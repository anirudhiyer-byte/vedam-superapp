/**
 * VSAT pipeline grid · column catalogue helpers (migration 0097).
 *
 * The database decides which columns exist and who may see them (vsat_grid_columns /
 * vsat_grid_list). These helpers only give the columns readable names, pick the default set
 * for each panel, format cell values and turn pasted search text into values.
 */
import { PANEL_STAGES, STAGE_LABEL, isStage, statusLabel, fmtIst, type PanelKey, type Stage } from "@/lib/vsat/pipeline";
import { ATTENDANCE_LABEL, MEET_LABEL, isMeetState } from "@/lib/vsat/interviews";
import { COUNSELLOR_FEEDBACK, FEEDBACK_LABEL, PARENT_LABEL, PARENT_PRESENT } from "@/lib/vsat/counselling-form";

/** 0184: the fee columns of the counselling sheet, shown in rupees. */
export const MONEY_KEYS = ["campus_fee", "cs_scholarship_amount", "cs_first_year_scholarship", "cs_actual_fee"] as const;

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
  // 0173: the verdict from Interview Evaluation, and the form's financial capability
  interview_verdict: [{ value: "selected", label: "Selected" }, { value: "maybe", label: "Maybe" }, { value: "not_selected", label: "Rejected" }],
  iv_financial: [{ value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" }],
  // 0179: the student's choice at PI cleared
  counselling_mode: [{ value: "online", label: "Online" }, { value: "offline", label: "Offline" }],
  // 0184: the "Selected for counselling" sheet's Counselor Feedback and Parent Present? answers
  cs_feedback: COUNSELLOR_FEEDBACK.map((value) => ({ value, label: FEEDBACK_LABEL[value] })),
  cs_parent_present: PARENT_PRESENT.map((value) => ({ value, label: PARENT_LABEL[value] })),
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
  // 0172 — the rest of the "14th July" / "Test Result" sheet columns
  first_name: "First name", last_name: "Last name", user_id: "User ID", exam_test_name: "Test name", exam_started_at: "Test start",
  exam_ended_at: "Test end", exam_time_taken: "Time taken", exam_total_questions: "Total questions", exam_attempted: "Attempted",
  exam_correct: "Correct", exam_incorrect: "Incorrect", exam_unattempted: "Unattempted", form_name: "Form name",
  interviewer: "Interviewer", interview_slot: "Interview slot (IST)", interview_attendance: "Interview status",
  interview_score: "Weighted score",
  // 0173 — sir's interview form, one column per question (the "Interview Responses" sheet), the verdict and the final score
  interview_submitted_at: "Form submitted (IST)", interview_verdict: "Verdict", interview_final_score: "Final score (out of 20)",
  iv_communication: "Communication & behaviour (1–5)", iv_communication_remarks: "Communication — remarks",
  iv_logic: "Guesstimate & logical reasoning (1–5)", iv_logic_remarks: "Logical reasoning — remarks",
  iv_passion: "Passion for CS (1–5)", iv_coding_talent: "Possible coding talent", iv_passion_remarks: "Passion for CS — remarks",
  iv_achievements: "Achievements & extracurricular (1–5)", iv_cert_asked: "National-level certificate asked for",
  iv_achievements_remarks: "Achievements — remarks", iv_why_program: "Why this program (1–5)", iv_why_program_remarks: "Why this program — remarks",
  iv_drop_year: "Drop year", iv_previous_jee: "Previous year's JEE percentile", iv_jee_pct: "JEE Mains percentile (interview)",
  iv_jee_maths_pct: "JEE Mains maths percentile (interview)", iv_expected_jee_pct: "Expected JEE percentile", iv_other_exams: "Other exam score",
  iv_class12_pct: "Class 12 % (interview)", iv_class11_pct: "Class 11 % (interview)", iv_class10_pct: "Class 10 % (interview)",
  iv_financial: "Financial capability", iv_financial_reason: "Financial capability — why", iv_why_accept: "Why should Vedam accept you",
  interview_meet: "Interview Meet", counselling_meet: "Counselling Meet",
  cheating_seen: "Cheating seen",
  counsellor: "Counsellor", counselling_slot: "Counselling slot (IST)", counselling_attendance: "Counselling status",
  interview_reschedules: "Interview reschedules", counselling_reschedules: "Counselling reschedules",
  counselling_category: "Scholarship category", counselling_pct: "Scholarship %", counselling_calculated_pct: "Calculated %",
  // 0184 — the "Selected for counselling" sheet (Pune / GGN): the interview's ×20 scores, the counsellor's answers, the fee maths
  pi_score_x20: "PI score (×20)", iv_cs_x20: "Comp science (×20)", iv_lr_x20: "Logical reasoning (×20)", cs_score: "Scholarship score",
  cs_feedback: "Counsellor feedback", cs_parent_present: "Parent present", cs_connected_students: "Already connected with existing students",
  cs_heard_from: "Came to know about Vedam from", cs_remarks: "Counsellor remarks", cs_adjust_pct: "Counsellor adjustment (±5 %)",
  cs_submitted_at: "Counselling form submitted (IST)", campus_fee: "Programme fee", cs_scholarship_amount: "Scholarship amount",
  cs_first_year_scholarship: "1st-year scholarship", cs_actual_fee: "Fee after scholarship",
  cs_offline_form_filled: "Offline form filled",
  // 0192: the sheet's three scholarship columns at its end (live, from the current buckets)
  cs_weightage_pct: "Scholarship as per weightage", cs_jee_pct: "Scholarship as per JEE Mains", cs_max_pct: "Max scholarship",
  // 0189: sir's offer-letter columns ("Selected For Counselling" sheet)
  ol_date_increase: "OL date increase (days)", seat_block_status: "Seat block status", seat_block_date: "Seat block date (IST)",
  ol_reminder_1: "OL reminder 1", ol_reminder_2: "OL reminder 2", ol_cancelled: "OL cancelled",
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
  // 0189: named as in sir's sheet ("OL Sending date", "OL Last date")
  offer_released_at: "OL sending date (IST)", offer_expires_at: "OL last date (IST)", offer_cancelled: "Offer cancelled",
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

/** VSAT Exam table (0172): the pipeline context, then the "14th July" sheet left to right, then the "Test Result" sheet. */
export const EXAM_SHEET_COLUMNS = [
  "registered_name", "campus", "vsat", "stage",
  // 14th July: Form Name … Percentage
  "form_name", "application_no", "first_name", "last_name", "registered_email", "registered_mobile", "gender", "date_of_birth",
  "guardian_mobile_number", "residing_city", "campus_applied", "country", "state", "city", "class10_year", "class12_year",
  "class12_marking_scheme", "class12_percentage", "studied_pcm", "jee_registered", "jee_appeared_when", "jee_score",
  "entrance_percentile", "jee_main_maths_percentile", "marks_physics_12", "marks_chemistry_12", "marks_maths_12",
  "class10_score", "class10_percentage", "class10_maths_percentage", "user_id", "class12_result", "class10_eligible",
  "class12_eligible", "eligible_effective", "proctoring", "exam_section_maths", "exam_section_lr", "exam_section_cs",
  "exam_obtained_marks", "exam_percentile", "exam_percentage",
  // Test Result: Login Id, Test Name, start / end, Total Question, Attempted, Correct, Incorrect, Unattempted, Maximum Score,
  // Time Taken, VPS
  "wheebox_login_id", "exam_test_name", "exam_started_at", "exam_ended_at", "exam_total_questions", "exam_attempted",
  "exam_correct", "exam_incorrect", "exam_unattempted", "exam_max_marks", "exam_time_taken", "vps_effective",
] as const;

/**
 * Interview table (0173): the booking columns, then sir's "Interview Responses" sheet left to right (Timestamp … Weighed
 * Score), then the sheet's Final Score. "Final Verdict" (Y) is the verdict from Interview Evaluation; "Interviewer Name"
 * (AA) is the Interviewer column at the front (a column shows once).
 */
export const INTERVIEW_SHEET_COLUMNS = [
  "registered_name", "campus", "vsat", "stage", "interviewer", "interview_slot", "interview_meet", "interview_attendance", "interview_reschedules",
  // Interview Responses: A Timestamp, B Application No, C–X the form, Y Final Verdict, Z, AB, AC, AD Weighed Score
  "interview_submitted_at", "application_no", "iv_communication", "iv_communication_remarks", "iv_logic", "cheating_seen",
  "iv_passion", "iv_coding_talent", "iv_passion_remarks", "iv_achievements", "iv_cert_asked", "iv_why_program", "iv_why_program_remarks",
  "iv_drop_year", "iv_previous_jee", "iv_jee_pct", "iv_jee_maths_pct", "iv_expected_jee_pct", "iv_other_exams",
  "iv_class12_pct", "iv_class11_pct", "iv_class10_pct", "iv_financial", "iv_financial_reason", "interview_verdict", "iv_why_accept",
  "iv_logic_remarks", "iv_achievements_remarks", "interview_score",
  // the sheet's "Final Score for Percentile" (weighted × 4)
  "interview_final_score",
] as const;

/**
 * Counselling table (0184): the booking columns, then sir's "Selected for counselling" sheet (Pune / GGN) left to right —
 * the interview answers and scores, the scholarship, the counsellor's answers, Status, Counseling Mode, Date — then the
 * fee columns at the sheet's end (fee, scholarship = fee × %, 1st year = ÷ 4, fee after scholarship). A column shows once
 * (Counselor / Status / Mode / Date are the booking columns at the front).
 * 0189: the sheet's offer-letter columns (OL Sending date, OL Last date, OL Date Increase, Seat Block Status / Date,
 * OL Reminder 1 / 2, OL Cancelled) come before the fee columns, in the sheet's order.
 * 0192: after the fee columns, the sheet's "Scholarship as Per Weightage", "as Per JEE Mains" and "Max Scholarship".
 */
export const COUNSELLING_SHEET_COLUMNS = [
  "registered_name", "campus", "vsat", "stage", "counsellor", "counselling_slot", "counselling_meet", "counselling_mode", "counselling_attendance",
  "counselling_reschedules",
  // 0186: the sheet's "Offline Form Filled"
  "cs_offline_form_filled",
  // the sheet: VEDAM ID, State, City, Financial Capability, Why?, the five remarks, Why should Vedam accept you
  "application_no", "state", "city", "iv_financial", "iv_financial_reason", "iv_communication_remarks", "iv_logic_remarks",
  "iv_passion_remarks", "iv_achievements_remarks", "iv_why_program_remarks", "iv_why_accept",
  // 10th %, Gender, VPS, Class 10 / 12 marks, PI score (×20), JEE Main, Comp Science (×20), Logical Reasoning (×20), JEE maths, 10th / 12th maths
  "class10_percentage", "gender", "vps_effective", "class12_percentage", "interview_score", "pi_score_x20", "entrance_percentile",
  "iv_passion", "iv_cs_x20", "iv_logic", "iv_lr_x20", "jee_main_maths_percentile", "class10_maths_percentage", "class12_maths_percentage",
  // Scholarship Score, Interviewer, Verdict, Category, Award, Actual Awarded (with the counsellor's ±5), the counsellor's answers
  "cs_score", "interviewer", "interview_verdict", "counselling_category", "counselling_calculated_pct", "cs_adjust_pct", "counselling_pct",
  "cs_feedback", "cs_parent_present", "cs_connected_students", "cs_heard_from", "cs_remarks", "cs_submitted_at",
  // 0189: the offer letter (sheet columns AU–BB)
  "offer_released_at", "offer_expires_at", "ol_date_increase", "seat_block_status", "seat_block_date", "ol_reminder_1", "ol_reminder_2",
  "ol_cancelled",
  // the fee maths at the sheet's end
  "campus_fee", "cs_scholarship_amount", "cs_first_year_scholarship", "cs_actual_fee",
  // 0192: then Scholarship as Per Weightage, as Per JEE Mains, Max Scholarship (Pune BK–BM, GGN BL–BN)
  "cs_weightage_pct", "cs_jee_pct", "cs_max_pct", "stage_changed_at",
] as const;

/** Default columns per panel — the ones the old panels showed. "registered_name" is always first and cannot be removed. */
export const DEFAULT_COLUMNS: Record<PanelKey, string[]> = {
  apps: ["registered_name", "campus", "vsat", "stage", "exam_percentile", "vps_effective", "eligible_effective", "stage_changed_at"],
  // 0172 — the owner's review (24 Nov): every column of the "14th July" sheet, in its order, then the "Test Result"
  // sheet's test marks, on the table itself (not only in the drawer). Wheebox sends no "Status" / "Submit By".
  // "Score / Slabs" (12th) is the 12th % as in the profile analysis (0085); the second "JEE Mains Score" is the percentile.
  exam: [...EXAM_SHEET_COLUMNS],
  // 0140 — Meet state and attendance next to the slot; 0166 — status + reschedule count, no interviewer verdict;
  // 0173 — the owner's review (24 Nov): every answer, mark and remark of the interview form as its own column, in the sheet's order
  intv: [...INTERVIEW_SHEET_COLUMNS],
  // 0144 — the offer deadline next to the scholarship; 0158 — the Meet state next to the slot; 0166 — status + reschedule count
  // 0179 — the student's Online / Offline choice right after the slot + Meet
  // 0184 — the owner's review (24 Nov): the "Selected for counselling" sheet's columns, in its order, after the booking ones
  couns: [...COUNSELLING_SHEET_COLUMNS],
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
  if (type === "status") return statusLabel(String(v));
  if (type === "bool") return v === true ? "Yes" : v === false ? "No" : String(v);
  if (VALUE_CHOICES[key] && typeof v === "string") return choiceLabel(key, v);
  if (key === "interview_meet" || key === "counselling_meet") {
    if (v === "own_link") return "—";  // old pasted link: no "Own link" word anywhere (Google Meet only, 0167)
    if (v === "zoom") return "Zoom";   // 0184: counselling on the counsellor's Zoom link
    if (v === "offline") return "Offline";  // 0186: an offline session, recorded with no invite
    return isMeetState(v) ? MEET_LABEL[v] : String(v);
  }
  // 0184: rupees, Indian grouping, whole rupees (as in the sheet)
  if ((MONEY_KEYS as readonly string[]).includes(key) && Number.isFinite(Number(v))) return `₹${Math.round(Number(v)).toLocaleString("en-IN")}`;
  if (key === "cs_adjust_pct" && Number.isFinite(Number(v))) return Number(v) > 0 ? `+${num(v)}%` : `${num(v)}%`;
  if (type === "ts") return fmtIst(String(v));
  if (type === "date") return istDate(v);
  // a JEE percentile is not a percentage (0173: the interview's JEE answers end in _pct like the class % ones)
  if (type === "num") return /_(pct|percentage)$/.test(key) && !/^iv_(jee|jee_maths|expected_jee)_pct$/.test(key) ? `${num(v)}%` : num(v);
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
