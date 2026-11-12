/**
 * VSAT pipeline · shared names, labels and checks for the admin panels.
 *
 * The database is the source of truth (migrations 0079–0081): it checks roles, stage rules,
 * reasons and every value again. These helpers only make the panels clear and catch obvious
 * mistakes before a round trip.
 */

export const STAGES = [
  "booked", "eligible", "exam_taken", "vsat_cleared", "interview_scheduled", "interviewed", "pi_cleared",
  "counselling_scheduled", "counselled", "offer_sent", "seat_blocked", "offer_lapsed", "offer_cancelled",
] as const;
export type Stage = (typeof STAGES)[number];

export const STATUSES = ["active", "not_selected", "absent", "on_hold"] as const;
export type Status = (typeof STATUSES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  booked: "Booked", eligible: "Eligible", exam_taken: "Exam taken", vsat_cleared: "VSAT cleared",
  interview_scheduled: "Interview scheduled", interviewed: "Interviewed", pi_cleared: "PI cleared",
  counselling_scheduled: "Counselling scheduled", counselled: "Counselled", offer_sent: "Offer sent",
  seat_blocked: "Seat blocked", offer_lapsed: "Offer lapsed", offer_cancelled: "Offer cancelled",
};

export const STATUS_LABEL: Record<Status, string> = {
  active: "Active", not_selected: "Not selected", absent: "Absent", on_hold: "On hold",
};

/** Which stages each panel shows (trickle-down: a panel only lists students who reached it). */
export type PanelKey = "apps" | "exam" | "intv" | "couns";
export const PANEL_STAGES: Record<PanelKey, readonly Stage[]> = {
  apps: STAGES,
  exam: ["booked", "eligible", "exam_taken", "vsat_cleared"],
  intv: ["vsat_cleared", "interview_scheduled", "interviewed", "pi_cleared"],
  couns: ["pi_cleared", "counselling_scheduled", "counselled", "offer_sent", "seat_blocked", "offer_lapsed", "offer_cancelled"],
};

export const STAGE_ORDER: Record<Stage, number> = {
  booked: 1, eligible: 2, exam_taken: 3, vsat_cleared: 4, interview_scheduled: 5, interviewed: 6, pi_cleared: 7,
  counselling_scheduled: 8, counselled: 9, offer_sent: 10, seat_blocked: 11, offer_lapsed: 11, offer_cancelled: 11,
};

export const isStage = (v: unknown): v is Stage => typeof v === "string" && (STAGES as readonly string[]).includes(v);
export const isStatus = (v: unknown): v is Status => typeof v === "string" && (STATUSES as readonly string[]).includes(v);

/**
 * Same rule as the database (vsat__move_checked): admin / admissions need a reason when moving
 * back, skipping a stage, setting not selected / on hold, or reopening a student who isn't active.
 */
export function needsReason(fromStage: Stage, fromStatus: Status, toStage: Stage, toStatus: Status): boolean {
  const a = STAGE_ORDER[fromStage], b = STAGE_ORDER[toStage];
  return b < a || b > a + 1 || toStatus === "not_selected" || toStatus === "on_hold" || (fromStatus !== "active" && toStatus === "active");
}

/** Moving into a scheduled stage needs an assignment first — the panels do that through "Assign". */
export const NEEDS_ASSIGNMENT: Partial<Record<Stage, "interviewer" | "counsellor">> = {
  interview_scheduled: "interviewer", counselling_scheduled: "counsellor",
};

export type VsatRoles = { admin: boolean; roles: string[] };
export const canManage = (r: VsatRoles) => r.admin || r.roles.includes("admissions");

/**
 * The one admin page a VSAT team member who isn't Vedam staff / admin may open (middleware).
 * Exact match only — /admin/vsat-early, /admin/vsat-forms etc. stay admin-only.
 */
export const isVsatTeamPath = (path: string) => path === "/admin/vsat" || path === "/admin/vsat/";

/** vsat_my_roles() result → has any VSAT role (admin or an active team role). */
export function hasVsatRole(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const o = data as { admin?: unknown; roles?: unknown };
  return o.admin === true || (Array.isArray(o.roles) && o.roles.some((r) => typeof r === "string" && r.length > 0));
}

/** Panels each person sees in the rail. */
export function visiblePanels(r: VsatRoles): PanelKey[] {
  if (canManage(r)) return ["apps", "exam", "intv", "couns"];
  const out: PanelKey[] = [];
  if (r.roles.includes("interviewer")) out.push("intv");
  if (r.roles.includes("counsellor")) out.push("couns");
  return out;
}

/** Database error codes → plain English for the panels. Unknown codes show a generic message (never raw DB text). */
const ERRORS: Record<string, string> = {
  FORBIDDEN: "You don't have access to this student or action.",
  NOT_SIGNED_IN: "Please sign in again.",
  NOT_IN_PIPELINE: "This student isn't in the VSAT pipeline yet.",
  REASON_REQUIRED: "Please add a reason (at least 3 characters).",
  REASON_TOO_LONG: "The reason is too long (500 characters max).",
  STAGE_CHANGED: "Someone else moved this student just now. Refresh and try again.",
  BAD_STAGE: "That stage doesn't exist.",
  BAD_STATUS: "That status doesn't exist.",
  NEEDS_INTERVIEWER: "Assign an interviewer and slot first.",
  NEEDS_COUNSELLOR: "Assign a counsellor and slot first.",
  NOT_AN_INTERVIEWER: "That person isn't an active interviewer.",
  NOT_A_COUNSELLOR: "That person isn't an active counsellor.",
  WRONG_STAGE: "The student isn't at the right stage for this.",
  SLOT_TAKEN: "That person already has another student at this time.",
  CAMPUS_MISSING: "The student has no campus yet, so the scholarship can't be calculated.",
  NO_OVERRIDE: "There's no override to remove.",
};
const FIELD_LABEL: Record<string, string> = {
  communication: "Communication", logic: "Logical reasoning", passion: "Passion for CS", achievements: "Achievements",
  why_program: "Why this program", cheating_seen: "Cheating seen", interviewer_verdict: "Your verdict",
  slot_datetime: "Slot", meet_link: "Meeting link", meeting_link: "Meeting link", chosen_step: "Scholarship step",
  actual_pct: "Actual %", special_rating: "Special rating", value: "Value", q: "Search",
};

export function errorText(raw: string | null | undefined): string {
  const m = String(raw ?? "").trim();
  if (ERRORS[m]) return ERRORS[m];
  const bad = /^BAD_VALUE: ([a-z_0-9]+)$/.exec(m);
  if (bad) return `Please check "${FIELD_LABEL[bad[1]] ?? bad[1].replace(/_/g, " ")}".`;
  if (/^UNKNOWN_KEY/.test(m)) return "The app sent something unexpected. Refresh the page and try again.";
  return "Something went wrong. Please try again.";
}

/** Interview form: five parts 1–5 (whole numbers), cheating seen and verdict required. */
export type InterviewForm = {
  communication: number | null; logic: number | null; passion: number | null; achievements: number | null; why_program: number | null;
  cheating_seen: boolean | null; interviewer_verdict: "selected" | "maybe" | "not_selected" | "";
};
export const PARTS = [
  ["communication", "Communication & behaviour"], ["logic", "Guesstimate & logical reasoning"], ["passion", "Passion & motivation for CS"],
  ["achievements", "Achievements & extracurriculars"], ["why_program", "Why this program"],
] as const;

export function interviewFormErrors(f: InterviewForm): string[] {
  const out: string[] = [];
  for (const [k, label] of PARTS) {
    const v = f[k];
    if (v === null || !Number.isInteger(v) || v < 1 || v > 5) out.push(`${label}: pick 1 to 5`);
  }
  if (f.cheating_seen === null) out.push("Cheating seen: pick yes or no");
  if (!f.interviewer_verdict) out.push("Your verdict: pick one");
  return out;
}

/** "2026-11-20" + "15:30" (IST) → ISO with +05:30, the only slot format the database accepts. */
export function istSlot(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const iso = `${date}T${time}:00+05:30`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** Meeting links must be https (the database refuses anything else). */
export const isHttpsLink = (v: string) => /^https:\/\/[a-z0-9.-]+\//i.test(v.trim());

export const fmtIst = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "—";
