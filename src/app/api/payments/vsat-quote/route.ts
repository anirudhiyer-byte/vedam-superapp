import { createClient } from "@supabase/supabase-js";
import { readVsatMoneyFlags, computeVsatFee, fetchValidCoupon } from "@/lib/payments/vsat-fee";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-authoritative fee quote for the logged-in applicant, so the dashboard can
 * render the 24-hour early-bird banner, apply a manual coupon, and show the exact pay
 * amount without ever trusting a client-side number. Read-only (no usage mutation).
 *
 * An optional `code` validates + merges a manual coupon (merge rule, not stacking).
 * We never return the auto 24h coupon NAME (admin-only); we DO echo the manual code
 * the student typed and its extra effect.
 */
export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !svcKey) return Response.json({ ok: false, error: "not configured" }, { status: 500 });
  let b: { accessToken?: string; code?: string }; try { b = await req.json(); } catch { return Response.json({ ok: false }, { status: 400 }); }
  if (!b.accessToken) return Response.json({ ok: false, error: "Not authorized" }, { status: 401 });

  const asUser = createClient(url, anon);
  const { data: u, error: uErr } = await asUser.auth.getUser(b.accessToken);
  if (uErr || !u?.user?.id) return Response.json({ ok: false, error: "Invalid session" }, { status: 401 });

  const svc = createClient(url, svcKey);
  const { data: app } = await svc.from("application_manager").select("created_at").eq("lead_id", u.user.id).maybeSingle();
  const flags = await readVsatMoneyFlags(svc);
  const createdAt = (app as { created_at?: string } | null)?.created_at;

  // optional manual coupon
  const typed = (b.code ?? "").trim();
  let couponInput = null, couponError: string | null = null;
  if (typed) {
    const look = await fetchValidCoupon(svc, typed);
    if (look.ok) couponInput = look.coupon; else couponError = look.reason;
  }

  const fee = computeVsatFee({ fee: flags.fee, discount24h: flags.discount24h, applicantCreatedAt: createdAt, coupon: couponInput });

  return Response.json({
    ok: true,
    base: fee.base, discount: fee.discount, net: fee.net,
    autoDiscount: fee.autoDiscount, couponDiscount: fee.couponDiscount,
    within24h: fee.within24h, windowEndsAt: fee.windowEndsAt, currency: fee.currency,
    coupon: typed ? {
      code: typed.toUpperCase(),
      applied: !!couponInput && fee.couponDiscount > 0,
      accepted: !!couponInput,
      extraOff: fee.couponDiscount,
      error: couponError, // null when accepted; e.g. "not_found" | "expired" | "inactive" | "exhausted"
    } : null,
  });
}
