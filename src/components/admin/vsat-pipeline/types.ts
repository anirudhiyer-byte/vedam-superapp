import type { Stage, Status } from "@/lib/vsat/pipeline";

/** Shapes returned by the VSAT pipeline RPCs (0080 / 0081). The database decides what each role gets. */
export type Effective = {
  vps: { calculated: number | null; override: number | null; value: number | null };
  eligible: { calculated: boolean | null; override: boolean | null; value: boolean | null; detail?: { class12?: string; pcm_total?: number } };
};

export type ListRow = {
  application_id: string; application_no: string | null; name: string | null; email: string | null; mobile: string | null;
  campus: "pune" | "gurugram" | null; exam_date_id: string | null; batch: string | null; attempt_no: number;
  stage: Stage; status: Status; stage_changed_at: string; exam_percentile: number | null; effective: Effective | null;
  interview: null | {
    interviewer: string | null; interviewer_id: string | null; slot: string | null; meet_link: string | null; attendance: string | null;
    score: number | null; calc_verdict: string | null; interviewer_verdict: string | null; cheating_seen: boolean | null; submitted: boolean;
  };
  counselling: null | {
    counsellor: string | null; counsellor_id: string | null; slot: string | null; meeting_link: string | null; attendance: string | null;
    category: number | null; pct: number | null;
  };
};

export type ListResult = { total: number; counts: Partial<Record<Stage, number>>; rows: ListRow[]; limit: number; offset: number };

export type Batch = { id: string; label: string; exam_date: string; cleared_vps_cutoff: number | null };
export type TeamMember = { user_id: string; name: string | null; email: string | null; roles: string[]; campus: string | null };

export type HistoryRow = {
  at: string; from_stage: Stage | null; to_stage: Stage; from_status: Status | null; to_status: Status;
  reason: string | null; source: string; attempt_no: number; by: string | null;
};

export type Student = {
  can_manage: boolean;
  pipeline: { stage: Stage; status: Status; attempt_no: number; stage_changed_at: string };
  profile: {
    application_id: string; application_no: string | null; name: string | null; email: string | null; mobile: string | null;
    gender: string | null; date_of_birth: string | null; city: string | null; state: string | null; campus: string | null;
    campus_applied: string | null; father_occupation: string | null; mother_occupation: string | null;
  };
  academics: Record<string, number | string | boolean | null>;
  exam: { batch: { label: string } | null; exam_given: boolean; percentile: number | null; marks: number | null; max_marks: number | null };
  effective: Effective;
  interview: null | (Record<string, unknown> & {
    interviewer: string | null; slot_datetime: string | null; meet_link: string | null; attendance: string | null;
    weighted_avg: number | null; calc_verdict: string | null; interviewer_verdict: string | null; cheating_seen: boolean | null;
    remarks: Record<string, string> | null; rubric_behavioural: number | null; rubric_math: number | null; rubric_passion: number | null;
    rubric_achievements: number | null; rubric_why_program: number | null; why_accept: string | null; financial_capability: string | null;
  });
  counselling: null | (Record<string, unknown> & {
    counsellor: string | null; slot_datetime: string | null; zoom_link: string | null; attendance: string | null;
    calc_score: number | null; calc_category: number | null; chosen_step: number | null; calculated_pct: number | null;
    actual_pct: number | null; actual_reason: string | null; special_rating: number | null; bonus_applied: boolean | null;
    scholarship_pct: number | null; scholarship_category: number | null;
    /** Profile analyser (0085): AI briefing for the counsellor, saved by the server only. */
    profile_analysis?: { text?: unknown; generated_at?: unknown; model?: unknown } | null;
  });
  overrides: { field: string; value: unknown; calculated: unknown; reason: string; set_at: string; by: string | null; cleared_at: string | null }[];
  history: HistoryRow[];
};

export type Preview = {
  case: string; score: number; category: number | null; min_award: number | null; max_award: number | null;
  award_steps: number[]; jee_floor: number | null; missing: string[]; inputs: Record<string, number | null>;
  campus: string; jee_floor_enabled: boolean; programme_fee: number;
  /** Interview "Achievements & extracurriculars" score (1–5), sheet column BQ. 5 → +10% when 30% or less. Set by the database (0082). */
  special_rating: number | null;
  /** Step from the score (sheet column BK), null when the score is in no band. Set by the database (0083). */
  auto_step: number | null;
};
