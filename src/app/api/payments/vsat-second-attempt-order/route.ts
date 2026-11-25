import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { createOrder, cashfreeConfigured } from "@/lib/payments/cashfree";
import { safeBaseUrl } from "@/lib/payments/base-url";
import { isTerminalFail } from "@/lib/vsat/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Flat second-attempt fee (₹). Overridable via app_flags.vsat_second_attempt_fee. */
const DEFAULT_SECOND_ATTEMPT_FEE = 500;


/**
 * Start the ₹500 SECOND-ATTEMPT fee payment for the logged-in applicant.
 *
 * Eligible only when attempt 1 is closed in a terminal-fail state, attempt 1 was paid, and a
 * second attempt hasn't already been paid. The amount is server-authoritative (flat fee from
 * app_flags). The order is tagged attempt=2; the webhook (confirmVsatPayment) records it into
 * payment_stage_2 — NOT vsat_payments — and the payment_stage_2 trigger resets the pipeline to
 * a fresh attempt 2. vsat_payments (the "paid" eligibility gate) stays attempt-1 only.
 */
export async function POST(req: Request) {
  try {
    if (!cashfreeConfigured()) return Response.json({ ok: false, error: "Payments not configured" }, { status: 503 });
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !anon || !svcKey) return Response.json({ ok: false, error: "not configured" }, { status: 500 });

    const body = (await req.json().catch(() => ({}))) as { accessToken?: string };
    if (!body.accessToken) return Response.json({ ok: false, error: "Not authorized" }, { status: 401 });

    const asUser = createClient(url, anon);
    const { data: u, error: uErr } = await asUser.auth.getUser(body.accessToken);
    if (uErr || !u?.user?.id) return Response.json({ ok: false, error: "Invalid session" }, { status: 401 });
    const userId = u.user.id;

    const svc = createClient(url, svcKey);

    // per-user rate limit on order creation
    try {
      const { data: ok } = await svc.rpc("rate_limit_hit", { p_key: "vsat_pay2_order:" + userId, p_max: 20, p_window: 3600 });
      if (ok === false) return Response.json({ ok: false, error: "Too many attempts — try again in a bit." }, { status: 429 });
    } catch { /* if the limiter errors, don't block a genuine payment */ }

    // must be an applicant
    const { data: appRow } = await svc.from("application_manager")
      .select("application_id, payment_stage_1, payment_stage_2, registered_name, registered_email, registered_mobile")
      .eq("lead_id", userId).maybeSingle();
    const app = appRow as {
      application_id: string; payment_stage_1: string | null; payment_stage_2: string | null;
      registered_name: string | null; registered_email: string | null; registered_mobile: string | null;
    } | null;
    if (!app) return Response.json({ ok: false, error: "not_an_applicant" }, { status: 409 });

    // attempt 1 must have been paid
    if (app.payment_stage_1 !== "payment_approved") return Response.json({ ok: false, error: "attempt1_not_paid" }, { status: 409 });
    // already paid for / into attempt 2?
    if (app.payment_stage_2 === "payment_approved") return Response.json({ ok: false, error: "already_paid" }, { status: 409 });

    // must be closed in a terminal-fail state on attempt 1
    const { data: vpRow } = await svc.from("vsat_pipeline")
      .select("stage, status, attempt_no").eq("application_id", app.application_id).maybeSingle();
    const vp = vpRow as { stage: string; status: string; attempt_no: number } | null;
    if (!vp || vp.attempt_no !== 1 || !isTerminalFail(vp.stage, vp.status)) {
      return Response.json({ ok: false, error: "not_eligible_for_retry" }, { status: 409 });
    }

    // server-authoritative flat fee
    let fee = DEFAULT_SECOND_ATTEMPT_FEE;
    const { data: flag } = await svc.from("app_flags").select("value").eq("key", "vsat_second_attempt_fee").maybeSingle();
    const flagged = Number((flag as { value?: string } | null)?.value);
    if (Number.isFinite(flagged) && flagged > 0) fee = flagged;

    const cfOrderId = "VSATPAY_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);

    // ledger row FIRST (attempt = 2 so the webhook routes it to payment_stage_2)
    const { error: insErr } = await svc.from("vsat_payment_orders").insert({
      cf_order_id: cfOrderId, lead_id: userId, user_email: app.registered_email,
      attempt: 2, base_amount: fee, discount: 0, discount_coupon: null,
      amount: fee, currency: "INR", status: "created",
    });
    if (insErr) return Response.json({ ok: false, error: insErr.message }, { status: 500 });

    const SITE = safeBaseUrl(req);
    const order = await createOrder({
      orderId: cfOrderId, amount: fee, currency: "INR", customerId: userId,
      customerEmail: app.registered_email, customerPhone: app.registered_mobile, customerName: app.registered_name,
      returnUrl: `${SITE}/apply/payment-success?order={order_id}`,
      notifyUrl: `${SITE}/api/payments/cashfree-webhook`,
      note: "VSAT fee · Attempt 2",
    });
    if (!order.ok) {
      await svc.from("vsat_payment_orders").update({ status: "failed", raw: { create_error: order.error } }).eq("cf_order_id", cfOrderId);
      return Response.json({ ok: false, error: order.error }, { status: 502 });
    }
    await svc.from("vsat_payment_orders").update({ cf_payment_session_id: order.paymentSessionId }).eq("cf_order_id", cfOrderId);

    // reflect "payment initiated" for attempt 2 (display-only)
    await svc.from("application_manager").update({
      order_id: cfOrderId,
      payment_stage_2: "payment_initiated",
      payment_stage_2_at: new Date().toISOString(),
      payment_amount: fee,
      currency: "INR",
      last_updated_date: new Date().toISOString(),
    }).eq("application_id", app.application_id);

    await svc.from("crm_activity_log").insert({
      entity_type: "application", application_id: app.application_id, lead_id: userId,
      action: "stage_change", stage_type: "payment", to_value: "payment_initiated",
      metadata: { order_id: cfOrderId, net: fee, attempt: 2 },
      actor: "applicant", path: "/apply/dashboard",
    });

    return Response.json({
      ok: true, paymentSessionId: order.paymentSessionId, orderId: cfOrderId,
      amount: fee, base: fee, discount: 0, attempt: 2,
      mode: (process.env.CASHFREE_ENV || "sandbox").toLowerCase(),
    });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 500 });
  }
}
