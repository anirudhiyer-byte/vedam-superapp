import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { createOrder, cashfreeConfigured } from "@/lib/payments/cashfree";
import { safeBaseUrl } from "@/lib/payments/base-url";
import { readVsatMoneyFlags, computeVsatFee } from "@/lib/payments/vsat-fee";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Start the VSAT fee payment for the logged-in applicant.
 *
 * The amount is server-authoritative: base fee + the automatic 24-hour early-bird
 * discount are read from the DB (never the client). We create a 'created' row in
 * the vsat_payment_orders ledger (so a webhook that races the response still finds
 * the order and knows the exact amount), then a Cashfree order, and return the
 * payment_session_id for cashfree.js checkout. The payment is only CONFIRMED later
 * by the webhook / status route re-verifying PAID with Cashfree.
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
      const { data: ok } = await svc.rpc("rate_limit_hit", { p_key: "vsat_pay_order:" + userId, p_max: 20, p_window: 3600 });
      if (ok === false) return Response.json({ ok: false, error: "Too many attempts — try again in a bit." }, { status: 429 });
    } catch { /* if the limiter errors, don't block a genuine payment */ }

    // already paid? the source of truth is vsat_payments — never charge twice for the same attempt
    const { data: paidRow } = await svc.from("vsat_payments").select("lead_id").eq("lead_id", userId).maybeSingle();
    if (paidRow) return Response.json({ ok: false, error: "already_paid" }, { status: 409 });

    // must be an applicant (Start application done). created_at drives the 24h window.
    const { data: appRow } = await svc.from("application_manager")
      .select("application_id, created_at, current_attempt, registered_name, registered_email, registered_mobile")
      .eq("lead_id", userId).maybeSingle();
    const app = appRow as {
      application_id: string; created_at: string; current_attempt: number | null;
      registered_name: string | null; registered_email: string | null; registered_mobile: string | null;
    } | null;
    if (!app) return Response.json({ ok: false, error: "not_an_applicant" }, { status: 409 });

    // server-authoritative amount + 24h early-bird discount
    const flags = await readVsatMoneyFlags(svc);
    const fee = computeVsatFee({ fee: flags.fee, discount24h: flags.discount24h, applicantCreatedAt: app.created_at });

    const attempt = app.current_attempt ?? 1;
    const cfOrderId = "VSATPAY_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);

    // ledger row FIRST (so a webhook that races the response still finds the order + amount)
    const { error: insErr } = await svc.from("vsat_payment_orders").insert({
      cf_order_id: cfOrderId, lead_id: userId, user_email: app.registered_email,
      attempt, base_amount: fee.base, discount: fee.discount, discount_coupon: fee.coupon,
      amount: fee.net, currency: fee.currency, status: "created",
    });
    if (insErr) return Response.json({ ok: false, error: insErr.message }, { status: 500 });

    const SITE = safeBaseUrl(req);
    const order = await createOrder({
      orderId: cfOrderId, amount: fee.net, currency: fee.currency, customerId: userId,
      customerEmail: app.registered_email, customerPhone: app.registered_mobile, customerName: app.registered_name,
      returnUrl: `${SITE}/vsat/dashboard?pay=return&order={order_id}`,
      // shared webhook already registered in Cashfree (events/bootcamps); it dispatches
      // VSATPAY_ orders to confirmVsatPayment. The /api/payments/vsat-webhook route also
      // exists and works if ever registered separately.
      notifyUrl: `${SITE}/api/payments/cashfree-webhook`,
      note: "VSAT fee",
    });
    if (!order.ok) {
      await svc.from("vsat_payment_orders").update({ status: "failed", raw: { create_error: order.error } }).eq("cf_order_id", cfOrderId);
      return Response.json({ ok: false, error: order.error }, { status: 502 });
    }
    await svc.from("vsat_payment_orders").update({ cf_payment_session_id: order.paymentSessionId }).eq("cf_order_id", cfOrderId);

    // reflect "payment initiated" on the application for admin/CRM display (display-only — access is decided by vsat_payments)
    await svc.from("application_manager").update({
      order_id: cfOrderId,
      payment_stage_1: "payment_initiated",
      payment_stage_1_at: new Date().toISOString(),
      payment_start_date: new Date().toISOString(),
      application_fee_amount: fee.base,
      discount: fee.discount,
      discount_coupon: fee.coupon,
      discount_source: fee.source,
      payment_amount: fee.net,
      currency: fee.currency,
      last_updated_date: new Date().toISOString(),
    }).eq("application_id", app.application_id);

    await svc.from("crm_activity_log").insert({
      entity_type: "application", application_id: app.application_id, lead_id: userId,
      action: "stage_change", stage_type: "payment", to_value: "payment_initiated",
      metadata: { order_id: cfOrderId, base: fee.base, discount: fee.discount, net: fee.net, coupon: fee.coupon },
      actor: "applicant", path: "/vsat/dashboard",
    });

    return Response.json({
      ok: true, paymentSessionId: order.paymentSessionId, orderId: cfOrderId,
      amount: fee.net, base: fee.base, discount: fee.discount, within24h: fee.within24h,
      mode: (process.env.CASHFREE_ENV || "sandbox").toLowerCase(),
    });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 500 });
  }
}
