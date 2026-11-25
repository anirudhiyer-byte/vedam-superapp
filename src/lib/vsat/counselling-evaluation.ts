/**
 * VSAT Counselling Evaluation (0184, owner's review 24 Nov 2026): one VSAT at a time, what happened in counselling —
 * Online / Offline choice, booked sessions and their Status, the counsellor's "likely to pay" feedback, the scholarship
 * given (formula % and awarded % after the counsellor's ±5) and the ARPU, i.e. the average fee a counselled student pays
 * after the scholarship, per campus and overall. Every number comes from vsat_counselling_analysis; this only names
 * and formats them.
 */
import { FEEDBACK_LABEL, type CounsellorFeedback } from "./counselling-form";

export type CampusKey = "pune" | "gurugram";

export type CounsellingAnalysis = {
  vsat: string;
  exam_date_id: string;
  campus: CampusKey | null;
  students: number;
  mode: { online: number; offline: number; not_chosen: number };
  booked: number;
  status: { done: number; no_show: number; rescheduled: number; not_marked: number };
  counselled: number;
  feedback: { likely: number; may_or_may_not: number; unlikely: number; not_given: number };
  scholarship: { avg_calculated: number | null; avg_awarded: number | null; max: number | null; min: number | null };
  campuses: { campus: CampusKey; fee: number | null; students: number; counselled: number; avg_awarded: number | null; arpu: number | null }[];
  arpu: number | null;
  list: CounsellingStudent[];
};

export type CounsellingStudent = {
  application_id: string;
  application_no: string | null;
  name: string | null;
  campus: CampusKey | null;
  mode: "online" | "offline" | null;
  counsellor: string | null;
  slot: string | null;
  attendance: string | null;
  feedback: CounsellorFeedback | null;
  calculated_pct: number | null;
  awarded_pct: number | null;
  fee: number | null;
  actual_fee: number | null;
  stage: string;
  status: string;
};

/** The list is capped by the database at 1000 students. */
export const LIST_CAP = 1000;

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** ₹18,50,000 — whole rupees, Indian grouping; "—" when there is no number. */
export function rupees(v: number | null | undefined): string {
  return finite(v) ? `₹${Math.round(v).toLocaleString("en-IN")}` : "—";
}

/** 18.5 L / 92,500 — short form for tiles (lakh above ₹1 lakh). */
export function rupeesShort(v: number | null | undefined): string {
  if (!finite(v)) return "—";
  if (Math.abs(v) >= 100_000) return `₹${(v / 100_000).toFixed(2).replace(/\.?0+$/, "")} L`;
  return rupees(v);
}

/** 32.5% — up to two decimals, "—" when there is no number. */
export function pct(v: number | null | undefined): string {
  return finite(v) ? `${Number(v.toFixed(2))}%` : "—";
}

/** Share of a whole as a rounded percent ("—" when the whole is 0). */
export function share(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—";
}

export const MODE_LABEL: Record<"online" | "offline", string> = { online: "Online", offline: "Offline" };
export const modeLabel = (m: string | null | undefined): string => (m === "online" || m === "offline" ? MODE_LABEL[m] : "Not chosen");
export const feedbackLabel = (f: string | null | undefined): string =>
  f && f in FEEDBACK_LABEL ? FEEDBACK_LABEL[f as CounsellorFeedback] : "Not given";

/** The awarded % differs from the formula's (the counsellor adjusted it): "+3" / "−2", or "" when it is the same. */
export function adjustment(s: Pick<CounsellingStudent, "calculated_pct" | "awarded_pct">): string {
  if (!finite(s.calculated_pct) || !finite(s.awarded_pct)) return "";
  const d = Number((s.awarded_pct - s.calculated_pct).toFixed(2));
  return d === 0 ? "" : d > 0 ? `+${d}` : `−${Math.abs(d)}`;
}
