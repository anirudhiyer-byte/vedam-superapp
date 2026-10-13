import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { createOrder, cashfreeConfigured } from "@/lib/payments/cashfree";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Resolve the base URL to send Cashfree's return + notify callbacks to, from the
 * ACTUAL request origin — so a staging payment returns to staging and a prod payment
 * to prod, instead of a hard-coded domain. Allowlisted to our own hosts so the Origin
 * header can never be spoofed into an open redirect; falls back to env/prod otherwise.
 */
function safeBaseUrl(req: Request): string {
  const envSite = (process.env.NEXT_PUBLIC_SITE_URL || "https://one.vedam.org").replace(/\/+$/, "");
  const allow = (h: string) => {
    h = (h || "").toLowerCase();
    return h === "vedam.org" || h.endsWith(".vedam.org") || h.endsWith(".vercel.app");
  };
  // 1) Origin header — modern browsers send it on same-origin POST
  const origin = req.headers.get("origin");
  if (origin) {
    try { const u = new URL(origin); if (u.protocol === "https:" && allow(u.hostname)) return `${u.protocol}//${u.host}`; } catch { /* */ }
  }
  // 2) forwarded host (server-to-server / no Origin)
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const proto = (req.headers.get("x-forwarded-proto") || "https").split(",")[0].trim();
  if (host) {
    try { const u = new URL(`${proto}://${host}`); if (allow(u.hostname)) return `${u.protocol}//${u.host}`; } catch { /* */ }
  }
  return envSite;
}

/**
 * Start a paid-event registration. Creates a server-side Cashfree order (amount read
 * from the DB — never from the client) + a 'created' event_payments row holding the
 * registration snapshot, and returns the payment_session_id for cashfree.js checkout.
 * No registration is created here — that happens only after a verified payment.
 */
export async function POST(req: Request) {
  try {
    if (!cashfreeConfigured()) return Response.json({ ok: false, error: "Payments not configured" }, { status: 503 });
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !anon || !svcKey) return Response.json({ ok: false, error: "not configured" }, { status: 500 });

    const body = (await req.json().catch(() => ({}))) as { eventId?: string; accessToken?: string; reg?: Record<string, unknown> };
    if (!body.eventId || !body.accessToken) return Response.json({ ok: false, error: "Not authorized" }, { status: 401 });

    // authenticate the user
    const asUser = createClient(url, anon);
    const { data: u, error: uErr } = await asUser.auth.getUser(body.accessToken);
    if (uErr || !u?.user?.id) return Response.json({ ok: false, error: "Invalid session" }, { status: 401 });
    const userId = u.user.id;

    const svc = createClient(url, svcKey);

    // per-user rate limit on order creation (fixed rate_limit_hit)
    try {
      const { data: ok } = await svc.rpc("rate_limit_hit", { p_key: "pay_order:" + userId, p_max: 20, p_window: 3600 });
      if (ok === false) return Response.json({ ok: false, error: "Too many attempts — try again in a bit." }, { status: 429 });
    } catch { /* if the limiter errors, don't block a genuine payment */ }

    // event must be a published paid event; AMOUNT COMES FROM THE DB
    const { data: evRow } = await svc.from("events").select("id, event_code, name, status, is_paid, price_amount, currency").eq("id", body.eventId).maybeSingle();
    const ev = evRow as { id: string; event_code: string; name: string; status: string; is_paid: boolean; price_amount: number | null; currency: string | null } | null;
    if (!ev) return Response.json({ ok: false, error: "Event not found" }, { status: 404 });
    if (ev.status === "draft") return Response.json({ ok: false, error: "Event not open" }, { status: 400 });
    if (!ev.is_paid || !ev.price_amount || ev.price_amount <= 0) return Response.json({ ok: false, error: "This event is not a paid event" }, { status: 400 });

    // already registered? don't create a duplicate paid order
    const { data: existingReg } = await svc.from("event_registrations").select("id").eq("event_id", ev.id).eq("user_id", userId).maybeSingle();
    if (existingReg) return Response.json({ ok: false, error: "already_registered" }, { status: 409 });

    // profile for customer details
    const { data: prof } = await svc.from("profiles").select("full_name, email, phone").eq("id", userId).maybeSingle();
    const pr = (prof || {}) as { full_name?: string; email?: string; phone?: string };
    const regEmail = pr.email || u.user.email || (body.reg?.user_email as string) || null;

    // registration snapshot (materialised verbatim on verified payment)
    const reg = (body.reg || {}) as Record<string, unknown>;
    const answers_snapshot = {
      event_code: ev.event_code,
      user_email: regEmail,
      full_name: pr.full_name ?? (reg.full_name ?? null),
      whatsapp: reg.whatsapp ?? pr.phone ?? null,
      passout_year: reg.passout_year ?? null,
      stream: reg.stream ?? null,
      answers: reg.answers ?? {},
      utm_source: reg.utm_source ?? null, utm_medium: reg.utm_medium ?? null, utm_campaign: reg.utm_campaign ?? null,
      referrer: reg.referrer ?? null, landing_path: reg.landing_path ?? null,
    };

    const SITE = safeBaseUrl(req);
    const cfOrderId = "VEDPAY_" + crypto.randomUUID().replace(/-/g, "").slice(0, 20);
    const amount = Number(ev.price_amount);
    const currency = ev.currency || "INR";

    // create the ledger row FIRST (so a webhook that races the response still finds it)
    const { error: insErr } = await svc.from("event_payments").insert({
      cf_order_id: cfOrderId, event_id: ev.id, user_id: userId, user_email: regEmail,
      amount, currency, status: "created", answers_snapshot,
    });
    if (insErr) return Response.json({ ok: false, error: insErr.message }, { status: 500 });

    const order = await createOrder({
      orderId: cfOrderId, amount, currency, customerId: userId,
      customerEmail: regEmail, customerPhone: pr.phone || null, customerName: pr.full_name || null,
      returnUrl: `${SITE}/events/${ev.event_code}?pay=return&order={order_id}`,
      notifyUrl: `${SITE}/api/payments/cashfree-webhook`,
      note: `Registration — ${ev.name}`,
    });
    if (!order.ok) {
      await svc.from("event_payments").update({ status: "failed", raw: { create_error: order.error } }).eq("cf_order_id", cfOrderId);
      return Response.json({ ok: false, error: order.error }, { status: 502 });
    }
    await svc.from("event_payments").update({ cf_payment_session_id: order.paymentSessionId }).eq("cf_order_id", cfOrderId);

    return Response.json({ ok: true, paymentSessionId: order.paymentSessionId, orderId: cfOrderId, mode: (process.env.CASHFREE_ENV || "sandbox").toLowerCase() });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 500 });
  }
}
