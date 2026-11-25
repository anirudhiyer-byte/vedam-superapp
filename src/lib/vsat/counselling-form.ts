/**
 * VSAT counselling form · the "Selected for counselling" sheet's counsellor columns (0184, owner's review 24 Nov 2026).
 *
 *   Counselor Feedback          Likely to pay / May or may not / Unlikely to pay
 *   Parent Present?             No / Yes (Mother, Father, both, a guardian, a sibling, someone else)
 *   Already Connected with Existing Students?   yes / no
 *   Came to know about Vedam from?              free text (≤ 300)
 *   Actual Scholarship Awarded  the formula's % plus the counsellor's adjustment, −5 to +5 whole points, with a reason
 *   Offline Form Filled         yes / no (0186)
 *
 * The database checks every value again (vsat_submit_counselling); these only shape the form and its messages.
 */

export const COUNSELLOR_FEEDBACK = ["likely", "may_or_may_not", "unlikely"] as const;
export type CounsellorFeedback = (typeof COUNSELLOR_FEEDBACK)[number];
export const FEEDBACK_LABEL: Record<CounsellorFeedback, string> = {
  likely: "Likely to pay", may_or_may_not: "May or may not", unlikely: "Unlikely to pay",
};

export const PARENT_PRESENT = ["no", "mother", "father", "both", "guardian", "sibling", "other"] as const;
export type ParentPresent = (typeof PARENT_PRESENT)[number];
export const PARENT_LABEL: Record<ParentPresent, string> = {
  no: "No", mother: "Yes (Mother)", father: "Yes (Father)", both: "Yes (both parents)",
  guardian: "Yes (Guardian)", sibling: "Yes (Sibling)", other: "Yes (someone else)",
};

export const ADJUST_MIN = -5;
export const ADJUST_MAX = 5;
export const HEARD_FROM_MAX = 300;
export const REMARKS_MAX = 2000;

/** The awarded % shown before saving: the formula's % plus the adjustment, kept within 0–100 (the database does the same). */
export function awardedPct(calculated: number | null | undefined, adjust: number): number | null {
  if (calculated === null || calculated === undefined || !Number.isFinite(calculated)) return null;
  return Math.min(100, Math.max(0, calculated + adjust));
}

export type CounsellingFormInput = {
  feedback: string; parentPresent: string; connected: "" | "yes" | "no"; heardFrom: string; remarks: string;
  adjust: string; adjustReason: string;
  /** the sheet's "Offline Form Filled" (0186); optional so an older caller still type-checks */
  offlineForm?: "" | "yes" | "no";
};
export type CounsellingFormCheck =
  | { ok: true; payload: Record<string, unknown>; adjust: number }
  | { ok: false; error: string };

/**
 * The form → the request for vsat_submit_counselling (only the keys it accepts). Blank answers are left out, so an
 * older form (remarks only) still saves exactly as before. The adjustment is a whole number from −5 to +5; any
 * adjustment other than 0 needs a reason.
 */
export function counsellingPayload(applicationId: string, f: CounsellingFormInput): CounsellingFormCheck {
  const adjText = f.adjust.trim().replace(/^\+/, "");
  const adjust = adjText === "" ? 0 : Number(adjText);
  if (!Number.isInteger(adjust) || adjust < ADJUST_MIN || adjust > ADJUST_MAX) {
    return { ok: false, error: `The adjustment is a whole number from ${ADJUST_MIN} to +${ADJUST_MAX} (percentage points).` };
  }
  const reason = f.adjustReason.trim();
  if (adjust !== 0 && !reason) return { ok: false, error: "Write why you changed the scholarship (needed for any adjustment other than 0)." };
  if (reason.length > 500) return { ok: false, error: "The reason is too long (500 characters at most)." };
  const heard = f.heardFrom.trim();
  if (heard.length > HEARD_FROM_MAX) return { ok: false, error: `"Came to know about Vedam from" is too long (${HEARD_FROM_MAX} characters at most).` };
  const remarks = f.remarks.trim();
  if (remarks.length > REMARKS_MAX) return { ok: false, error: `The remarks are too long (${REMARKS_MAX} characters at most).` };
  if (f.feedback && !(COUNSELLOR_FEEDBACK as readonly string[]).includes(f.feedback)) return { ok: false, error: "Pick the counsellor feedback from the list." };
  if (f.parentPresent && !(PARENT_PRESENT as readonly string[]).includes(f.parentPresent)) return { ok: false, error: "Pick who was present from the list." };

  const payload: Record<string, unknown> = { application_id: applicationId };
  if (remarks) payload.remarks = remarks;
  if (f.feedback) payload.feedback = f.feedback;
  if (f.parentPresent) payload.parent_present = f.parentPresent;
  if (f.connected) payload.connected_students = f.connected === "yes";
  if (f.offlineForm) payload.offline_form_filled = f.offlineForm === "yes";
  if (heard) payload.heard_from = heard;
  if (adjust !== 0) { payload.adjust_pct = adjust; payload.adjust_reason = reason; }
  return { ok: true, payload, adjust };
}
