import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * VSAT fee + the automatic 24-hour early-bird discount.
 *
 * The amount is ALWAYS server-authoritative: the base fee and the discount come
 * from app_flags (`vsat_fee`, `vsat_discount_24h`), never from the client. The
 * 24-hour window is measured from when the applicant was created
 * (application_manager.created_at). If they pay within 24h they get the discount,
 * applied silently — the student never sees a coupon, but we store the coupon
 * NAME on the application so we know this feature drove the conversion.
 */

export const VSAT_24H_COUPON = "24-hour registration";
export const VSAT_24H_SOURCE = "auto_24h_discount";
const WINDOW_MS = 24 * 60 * 60 * 1000;

export type VsatFee = {
  base: number;              // full VSAT fee, e.g. 1000
  discount: number;          // discount applied, e.g. 200 (0 if window passed)
  net: number;               // what the student is charged, e.g. 800
  coupon: string | null;     // coupon NAME stored on the application (admin-visible only)
  source: string | null;     // how the discount was applied
  within24h: boolean;        // is the early-bird window still open
  windowEndsAt: string | null; // ISO — when the discount expires
  currency: "INR";
};

/** Read the money flags from app_flags (server-authoritative). */
export async function readVsatMoneyFlags(svc: SupabaseClient): Promise<{ fee: number; discount24h: number }> {
  const { data } = await svc.from("app_flags").select("key,value").in("key", ["vsat_fee", "vsat_discount_24h"]);
  const map = new Map((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
  const fee = Number(map.get("vsat_fee"));
  const discount24h = Number(map.get("vsat_discount_24h"));
  return {
    fee: Number.isFinite(fee) && fee > 0 ? fee : 1000,
    discount24h: Number.isFinite(discount24h) && discount24h >= 0 ? discount24h : 0,
  };
}

/**
 * Compute the fee for an applicant, applying the 24h early-bird discount if they
 * are still inside the window measured from `applicantCreatedAt`.
 */
export function computeVsatFee(opts: {
  fee: number;
  discount24h: number;
  applicantCreatedAt: string | null | undefined;
  now?: number;
}): VsatFee {
  const now = opts.now ?? Date.now();
  const created = opts.applicantCreatedAt ? new Date(opts.applicantCreatedAt).getTime() : NaN;
  const windowEnd = Number.isFinite(created) ? created + WINDOW_MS : NaN;
  const within24h = Number.isFinite(windowEnd) && now < windowEnd && opts.discount24h > 0;
  const discount = within24h ? Math.min(opts.discount24h, opts.fee) : 0;
  const net = Math.max(0, opts.fee - discount);
  return {
    base: opts.fee,
    discount,
    net,
    coupon: discount > 0 ? VSAT_24H_COUPON : null,
    source: discount > 0 ? VSAT_24H_SOURCE : null,
    within24h,
    windowEndsAt: Number.isFinite(windowEnd) ? new Date(windowEnd).toISOString() : null,
    currency: "INR",
  };
}
