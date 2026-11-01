import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Enrollment (seat-blocking) fee — a flat, server-authoritative ₹50,000. Unlike
 * the VSAT fee there is no coupon and no 24h discount. The amount comes from
 * app_flags.enrollment_fee.
 */
export async function readEnrollmentFee(svc: SupabaseClient): Promise<number> {
  const { data } = await svc.from("app_flags").select("value").eq("key", "enrollment_fee").maybeSingle();
  const fee = Number((data as { value?: string } | null)?.value);
  return Number.isFinite(fee) && fee > 0 ? fee : 50000;
}

export type EnrollApp = {
  enrollment_stage?: string | null;
  application_stage_1?: string | null;
  scholarship_percentage?: number | null;
  offer_released_at?: string | null;
  offer_expires_at?: string | null;
  offer_cancelled?: boolean | null;
} | null;

export type EnrollGate = { ok: true } | { ok: false; code: string };

/**
 * The enroll button + payment are only allowed once counselling is done and a
 * valid offer letter (with a scholarship %) has been issued: offer released, not
 * cancelled, not expired, and the applicant is not already enrolled.
 */
export function offerPayable(app: EnrollApp, now: number = Date.now()): EnrollGate {
  if (!app) return { ok: false, code: "not_an_applicant" };
  if (app.enrollment_stage === "approved" || app.application_stage_1 === "enrolled") return { ok: false, code: "already_enrolled" };
  if (app.scholarship_percentage == null || !app.offer_released_at) return { ok: false, code: "no_offer" };
  if (app.offer_cancelled) return { ok: false, code: "offer_cancelled" };
  if (app.offer_expires_at && new Date(app.offer_expires_at).getTime() <= now) return { ok: false, code: "offer_expired" };
  return { ok: true };
}
