/**
 * VSAT · which application fields an applicant may change from the dashboard.
 *
 * H-01 fix: payment fields (payment_stage_*, payment_*_at, amounts, order ids …)
 * are NOT on this list, so /api/vsat/stage refuses them. Payment state will be
 * written only by the payment webhook (server side). Values are checked against
 * the database enums so a bad value is a clean 400, not a DB error.
 *
 * VSAT pipeline (owner's decision, 12 Nov 2026): application_stage_1/2 are no longer
 * user-writable. Stages are moved by staff through the database stage engine (0080)
 * and by server code; the dashboard only ever sent campus_applied. The slot fields
 * stay user-writable as before.
 */
const FORM_STAGES = ["not_started", "form_initiated", "basic_details", "academic_details", "parent_details", "documents_uploaded", "form_submitted"] as const;

// Campus choice is captured post-VSAT-cleared (before interview); same options as the /vsat form.
const CAMPUSES = ["Ajeenkya DY Patil University — Pune", "Sushant University — Gurugram", "No preference"] as const;

const oneOf = (list: readonly string[]) => (v: unknown) => typeof v === "string" && list.includes(v);
const isoDateTime = (v: unknown) =>
  typeof v === "string" && v.length <= 40 && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/.test(v) && !Number.isNaN(Date.parse(v));
const isUuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

const ALLOWED: Record<string, (v: unknown) => boolean> = {
  form_stage_1: oneOf(FORM_STAGES),
  form_stage_2: oneOf(FORM_STAGES),
  vsat_slot_datetime_1: isoDateTime,
  vsat_slot_datetime_2: isoDateTime,
  exam_date_id: isUuid,
  campus_applied: oneOf(CAMPUSES),
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
