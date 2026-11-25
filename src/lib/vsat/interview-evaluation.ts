/**
 * Interview Evaluation (0173) — pure helpers for the page that copies the interview sheet's evaluation for one VSAT.
 * The numbers come from vsat_interview_analysis; the verdict is saved by vsat_interview_set_verdicts. This file only
 * names, checks and lays them out.
 *
 * The sheet: Weighed Score = C×w1 + E×w2 + G×w3 + J×w4 + L×w5 (the five parts, 1–5, with the weights in force on the
 * interview day), Final Score = Weighed Score × 4 (out of 20). Average / highest / lowest / median Final Score for
 * everyone and for Select / Maybe / Reject.
 */

export type Verdict = "selected" | "maybe" | "not_selected";

/** The verdict words, as sir says them ("Selected", "Maybe", "Rejected"). */
export const VERDICT_LABEL: Record<Verdict, string> = { selected: "Selected", maybe: "Maybe", not_selected: "Rejected" };
export const isVerdict = (v: unknown): v is Verdict => v === "selected" || v === "maybe" || v === "not_selected";
export const verdictLabel = (v: unknown): string => (isVerdict(v) ? VERDICT_LABEL[v] : "Not decided yet");

/** The highest final score (weighted × 4 with weights that add up to 1). */
export const FINAL_MAX = 20;

/** The same rule as the database (vsat__interview_verdict): cheating → Rejected; no scores yet → null. */
export function verdictFor(final: number | null, cheating: boolean, selectMin: number | null, maybeMin: number | null): Verdict | null {
  if (cheating) return "not_selected";
  if (final === null || selectMin === null || maybeMin === null) return null;
  if (final >= selectMin) return "selected";
  if (final >= maybeMin) return "maybe";
  return "not_selected";
}

/** The two scores typed on the page: numbers from 0 to 20 (up to 2 decimals), Maybe not above Selected. */
export function parseScores(selectText: string, maybeText: string):
  { ok: true; selectMin: number; maybeMin: number } | { ok: false; error: string } {
  const num = (t: string) => (/^\d{1,2}(\.\d{1,2})?$/.test(t.trim()) ? Number(t.trim()) : NaN);
  const s = num(selectText), m = num(maybeText);
  if (!Number.isFinite(s) || s < 0 || s > FINAL_MAX) return { ok: false, error: `The Selected score must be a number from 0 to ${FINAL_MAX}.` };
  if (!Number.isFinite(m) || m < 0 || m > FINAL_MAX) return { ok: false, error: `The Maybe score must be a number from 0 to ${FINAL_MAX}.` };
  if (m > s) return { ok: false, error: "The Maybe score cannot be above the Selected score." };
  return { ok: true, selectMin: s, maybeMin: m };
}

export type SummaryRow = { key: "all" | Verdict; n: number; avg: number | null; max: number | null; min: number | null; median: number | null };
export type InterviewStudent = {
  application_id: string; application_no: string | null; name: string | null; campus: string | null; interviewer: string | null;
  weighted: number; final: number; cheating: boolean; verdict: Verdict | null; verdict_preview: Verdict | null; stage: string; status: string;
};
export type InterviewAnalysis = {
  vsat: string; exam_date_id: string;
  saved: { select_min: number | null; maybe_min: number | null; set_at: string | null; set_by: string | null };
  used: { select_min: number | null; maybe_min: number | null; preview: boolean };
  booked: number; interviewed: number; waiting: number; cheating: number;
  summary: SummaryRow[];
  ranges: { selected: number; maybe: number; not_selected: number; undecided: number };
  weighted: { avg: number | null; max: number | null; min: number | null };
  students: InterviewStudent[];
};
export type SetVerdictsResult = {
  vsat: string; select_min: number; maybe_min: number; changed: number;
  counts: { selected: number; maybe: number; not_selected: number };
};

/** Row names of the sheet's table. */
export const SUMMARY_LABEL: Record<SummaryRow["key"], string> = {
  all: "Everyone interviewed", selected: "Selected", maybe: "Maybe", not_selected: "Rejected",
};

/** The ranges line under the scores: "Selected (≥ 16): 12 · Maybe (10 to below 16): 5 · Rejected (below 10): 3". */
export function rangeLabels(selectMin: number | null, maybeMin: number | null, fmt: (n: number) => string):
  Record<"selected" | "maybe" | "not_selected", string> {
  if (selectMin === null || maybeMin === null) return { selected: "Selected", maybe: "Maybe", not_selected: "Rejected" };
  return {
    selected: `Selected (${fmt(selectMin)} and above)`,
    maybe: maybeMin === selectMin ? "Maybe (none: same score as Selected)" : `Maybe (${fmt(maybeMin)} to below ${fmt(selectMin)})`,
    not_selected: `Rejected (below ${fmt(maybeMin)}, or cheating)`,
  };
}

/** Did the preview change this student's verdict from the saved one? */
export const changesVerdict = (s: Pick<InterviewStudent, "verdict" | "verdict_preview">): boolean => s.verdict !== s.verdict_preview;
