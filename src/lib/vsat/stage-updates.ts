/**
 * VSAT · which application fields an applicant may change from the dashboard.
 *
 * H-01 fix: payment fields (payment_stage_*, payment_*_at, amounts, order ids …)
 * are NOT on this list, so /api/vsat/stage refuses them. Payment state will be
 * written only by the payment webhook (server side). Values are checked against
 * the database enums so a bad value is a clean 400, not a DB error.
 *
 * Left as before on purpose (owner's decision, 30 Oct 2026): application_stage_*
 * and the slot field stay user-writable until that flow is reworked.
 */
const FORM_STAGES = ["not_started", "form_initiated", "basic_details", "academic_details", "parent_details", "documents_uploaded", "form_submitted"] as const;
const APP_STAGES = [
  "payment_not_initiated", "payment_approved", "slot_selected", "exam_not_given", "vsat_cleared", "vsat_not_cleared",
  "interview_selected", "interview_rejected", "counselling_done", "offer_released", "enrolled", "offer_cancelled",
] as const;

const oneOf = (list: readonly string[]) => (v: unknown) => typeof v === "string" && list.includes(v);
const isoDateTime = (v: unknown) =>
  typeof v === "string" && v.length <= 40 && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/.test(v) && !Number.isNaN(Date.parse(v));

const ALLOWED: Record<string, (v: unknown) => boolean> = {
  form_stage_1: oneOf(FORM_STAGES),
  form_stage_2: oneOf(FORM_STAGES),
  application_stage_1: oneOf(APP_STAGES),
  application_stage_2: oneOf(APP_STAGES),
  vsat_slot_datetime_1: isoDateTime,
};

export type StageCheck =
  | { ok: true; updates: Record<string, string> }
  | { ok: false; error: "invalid_body" | "field_not_allowed" | "invalid_value"; field?: string };

export function validateStageUpdates(raw: unknown): StageCheck {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "invalid_body" };
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0 || entries.length > Object.keys(ALLOWED).length) return { ok: false, error: "invalid_body" };
  const updates: Record<string, string> = {};
  for (const [k, v] of entries) {
    const check = Object.prototype.hasOwnProperty.call(ALLOWED, k) ? ALLOWED[k] : undefined;
    if (!check) return { ok: false, error: "field_not_allowed", field: k };
    if (!check(v)) return { ok: false, error: "invalid_value", field: k };
    updates[k] = v as string;
  }
  return { ok: true, updates };
}
