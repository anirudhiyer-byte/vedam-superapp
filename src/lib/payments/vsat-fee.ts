import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * VSAT fee + the automatic 24-hour early-bird discount + manual coupons.
 *
 * The amount is ALWAYS server-authoritative: the base fee and the 24h discount come
 * from app_flags (`vsat_fee`, `vsat_discount_24h`); a manual coupon's value comes
 * from the `vsat_coupons` catalog — never from the client.
 *
 * The 24-hour window is measured from when the applicant was created
 * (application_manager.created_at). If they pay within 24h they get the discount,
 * applied silently — the student never sees the auto coupon, but we store its NAME
 * on the application so we know this feature drove the conversion.
 *
 * MERGE RULE (coupons do NOT stack on the 24h discount): the student always gets the
 * BETTER of the two, never the sum. So a ₹750 coupon inside the 24h window still
 * totals ₹750 off (shown as ₹200 auto + ₹550 coupon); after the window it is the full
 * ₹750. A coupon worth less than the active auto-discount simply yields no extra off.
 */

export const VSAT_24H_COUPON = "24-hour registration";
export const VSAT_24H_SOURCE = "auto_24h_discount";
export const VSAT_MANUAL_SOURCE = "manual_coupon";
const WINDOW_MS = 24 * 60 * 60 * 1000;

export type CouponInput = { code: string; amount: number; discount_type: "flat" | "percent" };

export type VsatFee = {
  base: number;              // full VSAT fee, e.g. 1000
  discount: number;          // TOTAL discount applied, e.g. 750
  net: number;               // what the student is charged, e.g. 250
  autoDiscount: number;      // the 24h early-bird portion (0 if window passed)
  couponDiscount: number;    // the EXTRA the coupon adds on top of the auto portion
  couponCode: string | null; // the manual coupon code applied (student-entered), if any
  coupon: string | null;     // coupon NAME stored on the application (manual code, else the 24h name)
  source: string | null;     // how the discount was applied
  within24h: boolean;        // is the early-bird window still open
  windowEndsAt: string | null; // ISO — when the 24h discount expires
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

export type CouponLookup = { ok: true; coupon: CouponInput } | { ok: false; reason: string };

/**
 * Look up + validate a manual coupon by code (server-side, service role). Codes are
 * stored upper-cased in the catalog, so we match exactly on the upper-cased input.
 * Returns the usable coupon or a reason it can't be applied. Does NOT mutate usage.
 */
export async function fetchValidCoupon(svc: SupabaseClient, code: string | null | undefined, now = Date.now()): Promise<CouponLookup> {
  const c = (code ?? "").trim();
  if (!c) return { ok: false, reason: "empty" };
  const { data } = await svc.from("vsat_coupons")
    .select("code,amount,discount_type,active,valid_from,valid_to,max_uses,used_count,coupon_type")
    .eq("code", c.toUpperCase()).maybeSingle();
  const row = data as {
    code: string; amount: number; discount_type: "flat" | "percent"; active: boolean;
    valid_from: string | null; valid_to: string | null; max_uses: number | null; used_count: number; coupon_type: string;
  } | null;
  if (!row || row.coupon_type !== "vsat") return { ok: false, reason: "not_found" };
  if (!row.active) return { ok: false, reason: "inactive" };
  if (row.valid_from && new Date(row.valid_from).getTime() > now) return { ok: false, reason: "not_started" };
  if (row.valid_to && new Date(row.valid_to).getTime() < now) return { ok: false, reason: "expired" };
  if (row.max_uses != null && row.used_count >= row.max_uses) return { ok: false, reason: "exhausted" };
  return { ok: true, coupon: { code: row.code, amount: Number(row.amount), discount_type: row.discount_type } };
}

/**
 * Compute the fee for an applicant: the 24h early-bird discount if still in-window,
 * merged (not stacked) with an optional manual coupon. Pure + deterministic.
 */
export function computeVsatFee(opts: {
  fee: number;
  discount24h: number;
  applicantCreatedAt: string | null | undefined;
  now?: number;
  coupon?: CouponInput | null;
}): VsatFee {
  const now = opts.now ?? Date.now();
  const created = opts.applicantCreatedAt ? new Date(opts.applicantCreatedAt).getTime() : NaN;
  const windowEnd = Number.isFinite(created) ? created + WINDOW_MS : NaN;
  const within24h = Number.isFinite(windowEnd) && now < windowEnd && opts.discount24h > 0;

  const auto = within24h ? Math.min(opts.discount24h, opts.fee) : 0;

  let couponValue = 0;
  let couponCode: string | null = null;
  if (opts.coupon && opts.coupon.amount > 0) {
    const raw = opts.coupon.discount_type === "percent"
      ? Math.round((opts.fee * opts.coupon.amount) / 100)
      : opts.coupon.amount;
    couponValue = Math.max(0, Math.min(raw, opts.fee));
    couponCode = opts.coupon.code;
  }

  // merge, not stack: the better of the two, capped at the fee
  const total = Math.min(opts.fee, Math.max(auto, couponValue));
  const net = Math.max(0, opts.fee - total);
  const couponDiscount = couponCode ? Math.max(0, total - auto) : 0;

  // coupon NAME stored on the application: a manual code wins (consultant attribution),
  // else the auto 24h name when that discount applied, else nothing.
  const coupon = couponCode ?? (auto > 0 ? VSAT_24H_COUPON : null);
  const source = couponCode ? VSAT_MANUAL_SOURCE : (auto > 0 ? VSAT_24H_SOURCE : null);

  return {
    base: opts.fee,
    discount: total,
    net,
    autoDiscount: auto,
    couponDiscount,
    couponCode,
    coupon,
    source,
    within24h,
    windowEndsAt: Number.isFinite(windowEnd) ? new Date(windowEnd).toISOString() : null,
    currency: "INR",
  };
}
