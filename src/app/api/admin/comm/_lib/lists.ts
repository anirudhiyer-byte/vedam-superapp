/**
 * Communication Manager · Manage List (Slice 3a) request rules. Pure, unit-tested.
 * The database checks the same whitelist again (comm__conditions_check), so a direct
 * API call cannot get around these rules.
 */
import { z } from "zod";
import { MAX_PAGE, MAX_PAGE_SIZE } from "./params";

/** database enum vm_lead_stage */
export const LEAD_STAGES = [
  "lead", "applicant_unpaid", "applicant_paid", "slot_selected", "vsat_cleared", "vsat_not_cleared", "interview_selected",
  "interview_rejected", "counselling_done", "offer_released", "enrolled", "offer_cancelled", "out_of_funnel",
] as const;
/** database enum vm_app_stage */
export const APP_STAGES = [
  "payment_not_initiated", "payment_approved", "slot_selected", "exam_not_given", "vsat_cleared", "vsat_not_cleared",
  "interview_selected", "interview_rejected", "counselling_done", "offer_released", "enrolled", "offer_cancelled", "mock_enabled",
] as const;
export const PAYMENT = ["paid", "not_paid", "started_not_paid"] as const;
export const MAX_CONDITIONS_BYTES = 4096;

const CONTROL = /[\u0000-\u001f\u007f]/;
const value = z.string().min(1).max(100).refine((s) => !CONTROL.test(s), "control characters");
const values = z.array(value).min(1).max(20);
const realDay = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s && s >= "2020-01-01" && s <= "2100-12-31";
};
const day = z.string().refine(realDay, "YYYY-MM-DD");

export const conditionsSchema = z
  .object({
    lead_stage: z.array(z.enum(LEAD_STAGES)).min(1).max(20),
    application_stage: z.array(z.enum(APP_STAGES)).min(1).max(20),
    lead_source: values, utm_source: values, utm_campaign: values, campus: values, state: values, city: values,
    grad_year: z.array(z.number().int().min(2000).max(2100)).min(1).max(20),
    signup: z.object({ from: day, to: day }).strict().refine((r) => r.from <= r.to, "from after to"),
    vsat_registered: z.boolean(), exam_assigned: z.boolean(), exam_given: z.boolean(), consent_given: z.boolean(),
    payment: z.enum(PAYMENT),
  })
  .partial()
  .strict()
  .refine((c) => new TextEncoder().encode(JSON.stringify(c)).length <= MAX_CONDITIONS_BYTES, "conditions too large");

export type Conditions = z.infer<typeof conditionsSchema>;

const name = z.string().transform((s) => s.trim()).pipe(z.string().min(1).max(80).refine((s) => !CONTROL.test(s), "control characters"));
// raw name may not contain control characters even before trimming (e.g. a newline in the middle)
const rawName = z.string().refine((s) => !CONTROL.test(s), "control characters").pipe(name);

export const createBody = z.object({ name: rawName, conditions: conditionsSchema }).strict();
export const updateBody = z
  .object({ name: rawName.optional(), conditions: conditionsSchema.optional() })
  .strict()
  .refine((b) => b.name !== undefined || b.conditions !== undefined, "nothing to change");
export const previewBody = z.object({ conditions: conditionsSchema }).strict();

const int = (min: number, max: number) => z.string().regex(/^\d{1,6}$/).transform(Number).pipe(z.number().int().min(min).max(max));
export const listsQuery = z
  .object({
    search: z.string().min(1).max(100).refine((s) => s.trim().length > 0).optional(),
    page: int(1, MAX_PAGE).optional(),
    size: int(1, MAX_PAGE_SIZE).optional(),
  })
  .strict();
