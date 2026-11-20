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
// VSAT early-registration floor: applicants who early-registered (vsat_registrations.registered)
// get AT LEAST this much off the form fee, merged (never stacked) with the 24h discount and any
// coupon — so they always get the BEST of the three. A bigger coupon can still beat the floor.
export const VSAT_EARLY_REG_COUPON = "VSAT early registration";
export const VSAT_EARLY_REG_SOURCE = "early_registration";
const WINDOW_MS = 24 * 60 * 60 * 1000;

export type CouponInput = { code: string; amount: number; discount_type: "flat" | "percent" };

export type VsatFee = {
  base: number;              // full VSAT fee, e.g. 1000
  discount: number;          // TOTAL discount applied, e.g. 750
  net: number;               // what the student is charged, e.g. 250
  autoDiscount: number;      // the 24h early-bird portion (0 if window passed)
  couponDiscount: number;    // the EXTRA the coupon adds on top of the auto portion
  earlyRegDiscount: number;  // the EXTRA the early-reg floor adds on top of the auto portion
  earlyReg: boolean;         // did the early-registration floor drive the total
  couponCode: string | null; // the manual coupon code applied (student-entered), if any
  coupon: string | null;     // coupon NAME stored on the application (manual code, else 24h / early-reg name)
  source: string | null;     // how the discount was applied
  within24h: boolean;        // is the early-bird window still open
  windowEndsAt: string | null; // ISO — when the 24h discount expires
  currency: "INR";
};

/** Read the money flags from app_flags (server-authoritative). */
export async function readVsatMoneyFlags(svc: SupabaseClient): Promise<{ fee: number; discount24h: number; earlyRegDiscount: number }> {
  const { data } = await svc.from("app_flags").select("key,value").in("key", ["vsat_fee", "vsat_discount_24h", "vsat_early_reg_discount"]);
  const map = new Map((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
  const fee = Number(map.get("vsat_fee"));
  const discount24h = Number(map.get("vsat_discount_24h"));
  const earlyRegDiscount = Number(map.get("vsat_early_reg_discount"));
  return {
    fee: Number.isFinite(fee) && fee > 0 ? fee : 1000,
    discount24h: Number.isFinite(discount24h) && discount24h >= 0 ? discount24h : 0,
    earlyRegDiscount: Number.isFinite(earlyRegDiscount) && earlyRegDiscount >= 0 ? earlyRegDiscount : 0,
  };
}

/**
 * Did this user early-register for VSAT? True iff they have a vsat_registrations row with
 * registered = true (the old /vsat early-registration form). Service-role read, no mutation.
 * Drives the early-registration discount floor in computeVsatFee.
 */
export async function isEarlyRegistrant(svc: SupabaseClient, userId: string): Promise<boolean> {
  if (!userId) return false;
  const { data } = await svc.from("vsat_registrations").select("user_id").eq("user_id", userId).eq("registered", true).maybeSingle();
  return !!data;
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
  earlyReg?: boolean;        // did this applicant early-register (vsat_registrations.registered)
  earlyRegDiscount?: number; // the early-reg floor amount (from app_flags), applies only when earlyReg
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

  // early-registration floor (0 unless the applicant early-registered and a floor is configured)
  const earlyRegValue = opts.earlyReg && (opts.earlyRegDiscount ?? 0) > 0
    ? Math.min(opts.earlyRegDiscount as number, opts.fee) : 0;

  // merge, not stack: the BEST of the three, capped at the fee
  const total = Math.min(opts.fee, Math.max(auto, couponValue, earlyRegValue));
  const net = Math.max(0, opts.fee - total);
  const extra = Math.max(0, total - auto); // the amount on top of the 24h portion

  // attribute the `extra` to a single winner. A manual coupon wins ties (consultant attribution),
  // then the early-reg floor; the 24h portion is always shown as `autoDiscount`.
  const couponWins = !!couponCode && couponValue > auto && couponValue >= earlyRegValue;
  const earlyRegWins = !couponWins && earlyRegValue > auto;
  const couponDiscount = couponWins ? extra : 0;
  const earlyRegDiscount = earlyRegWins ? extra : 0;

  // coupon NAME stored on the application: manual code wins, else early-reg, else the 24h name.
  const coupon = couponWins ? couponCode : earlyRegWins ? VSAT_EARLY_REG_COUPON : (auto > 0 ? VSAT_24H_COUPON : null);
  const source = couponWins ? VSAT_MANUAL_SOURCE : earlyRegWins ? VSAT_EARLY_REG_SOURCE : (auto > 0 ? VSAT_24H_SOURCE : null);

  return {
    base: opts.fee,
    discount: total,
    net,
    autoDiscount: auto,
    couponDiscount,
    earlyRegDiscount,
    earlyReg: earlyRegWins,
    couponCode: couponWins ? couponCode : null,
    coupon,
    source,
    within24h,
    windowEndsAt: Number.isFinite(windowEnd) ? new Date(windowEnd).toISOString() : null,
    currency: "INR",
  };
}
