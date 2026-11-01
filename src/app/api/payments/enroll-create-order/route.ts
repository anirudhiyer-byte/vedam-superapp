import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { createOrder, cashfreeConfigured } from "@/lib/payments/cashfree";
import { safeBaseUrl } from "@/lib/payments/base-url";
import { readEnrollmentFee, offerPayable, type EnrollApp } from "@/lib/payments/enroll-fee";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Start the ₹50,000 enrollment (seat-blocking) payment for the logged-in applicant.
 *
 * Only allowed once a valid offer letter has been issued (offerPayable). The amount
 * is server-authoritative (app_flags.enrollment_fee) — no coupon, no discount. We
 * write a 'created' row in the vsat_payment_orders ledger tagged kind='enrollment'
 * (order id prefix ENROLLPAY_), then a Cashfree order. The payment is CONFIRMED
 * later by the webhook / status route re-verifying PAID with Cashfree.
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

    try {
      const { data: ok } = await svc.rpc("rate_limit_hit", { p_key: "enroll_pay_order:" + userId, p_max: 20, p_window: 3600 });
      if (ok === false) return Response.json({ ok: false, error: "Too many attempts — try again in a bit." }, { status: 429 });
    } catch { /* never block a genuine payment on the limiter */ }

    const { data: appRow } = await svc.from("application_manager")
      .select("application_id, enrollment_stage, application_stage_1, scholarship_percentage, offer_released_at, offer_expires_at, offer_cancelled, registered_name, registered_email, registered_mobile")
      .eq("lead_id", userId).maybeSingle();
    const app = appRow as (EnrollApp & { application_id: string; registered_name: string | null; registered_email: string | null; registered_mobile: string | null }) | null;

    const gate = offerPayable(app);
    if (!gate.ok) return Response.json({ ok: false, error: gate.code }, { status: 409 });

    const fee = await readEnrollmentFee(svc);
    const cfOrderId = "ENROLLPAY_" + crypto.randomUUID().replace(/-/g, "").slice(0, 18);

    const { error: insErr } = await svc.from("vsat_payment_orders").insert({
      cf_order_id: cfOrderId, lead_id: userId, user_email: app!.registered_email,
      attempt: 1, base_amount: fee, discount: 0, discount_coupon: null,
      amount: fee, currency: "INR", status: "created", kind: "enrollment",
    });
    if (insErr) return Response.json({ ok: false, error: insErr.message }, { status: 500 });

    const SITE = safeBaseUrl(req);
    const order = await createOrder({
      orderId: cfOrderId, amount: fee, currency: "INR", customerId: userId,
      customerEmail: app!.registered_email, customerPhone: app!.registered_mobile, customerName: app!.registered_name,
      returnUrl: `${SITE}/vsat/dashboard?pay=enroll_return&order={order_id}`,
      notifyUrl: `${SITE}/api/payments/cashfree-webhook`,
      note: "VSAT enrollment fee",
    });
    if (!order.ok) {
      await svc.from("vsat_payment_orders").update({ status: "failed", raw: { create_error: order.error } }).eq("cf_order_id", cfOrderId);
      return Response.json({ ok: false, error: order.error }, { status: 502 });
    }
    await svc.from("vsat_payment_orders").update({ cf_payment_session_id: order.paymentSessionId }).eq("cf_order_id", cfOrderId);

    await svc.from("application_manager").update({
      enrollment_order_id: cfOrderId, enrollment_stage: "initiated",
      enrollment_amount: fee, last_updated_date: new Date().toISOString(),
    }).eq("application_id", app!.application_id);

    await svc.from("crm_activity_log").insert({
      entity_type: "application", application_id: app!.application_id, lead_id: userId,
      action: "stage_change", stage_type: "enrollment", to_value: "initiated",
      metadata: { order_id: cfOrderId, amount: fee }, actor: "applicant", path: "/vsat/dashboard",
    });

    return Response.json({
      ok: true, paymentSessionId: order.paymentSessionId, orderId: cfOrderId,
      amount: fee, mode: (process.env.CASHFREE_ENV || "sandbox").toLowerCase(),
    });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 500 });
  }
}
