import crypto from "crypto";
import { fetchResilient } from "@/lib/resilience";

/**
 * Cashfree Payment Gateway — server-only client.
 * Secrets come from env (CASHFREE_APP_ID / CASHFREE_SECRET_KEY); the base URL is
 * chosen by CASHFREE_ENV (sandbox | production). NEVER import this into client code.
 */

const API_VERSION = "2023-08-01";

function cfConfig() {
  const appId = process.env.CASHFREE_APP_ID;
  const secret = process.env.CASHFREE_SECRET_KEY;
  const env = (process.env.CASHFREE_ENV || "sandbox").toLowerCase();
  const base = env === "production" ? "https://api.cashfree.com/pg" : "https://sandbox.cashfree.com/pg";
  return { appId, secret, base, env };
}

export function cashfreeConfigured(): boolean {
  const { appId, secret } = cfConfig();
  return !!appId && !!secret;
}

function headers() {
  const { appId, secret } = cfConfig();
  return {
    "x-client-id": appId || "",
    "x-client-secret": secret || "",
    "x-api-version": API_VERSION,
    "Content-Type": "application/json",
    accept: "application/json",
  };
}

export type CreateOrderInput = {
  orderId: string;
  amount: number;            // INR, from the DB (server-authoritative)
  currency?: string;
  customerId: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerName?: string | null;
  returnUrl: string;         // {order_id} placeholder allowed by Cashfree
  notifyUrl?: string;
  note?: string;
};

export type CreateOrderResult =
  | { ok: true; paymentSessionId: string; orderId: string; raw: Record<string, unknown> }
  | { ok: false; error: string };

/** Create an order server-side → returns the payment_session_id for cashfree.js checkout. */
export async function createOrder(i: CreateOrderInput): Promise<CreateOrderResult> {
  const { base } = cfConfig();
  if (!cashfreeConfigured()) return { ok: false, error: "cashfree_not_configured" };
  const body = {
    order_id: i.orderId,
    order_amount: Number(i.amount),
    order_currency: i.currency || "INR",
    customer_details: {
      customer_id: i.customerId,
      // Cashfree requires a phone; fall back to a placeholder when we genuinely don't have one
      customer_phone: (i.customerPhone || "").replace(/\D/g, "").slice(-10) || "9999999999",
      customer_email: i.customerEmail || undefined,
      customer_name: i.customerName || undefined,
    },
    order_meta: {
      return_url: i.returnUrl,
      notify_url: i.notifyUrl || undefined,
    },
    order_note: i.note || undefined,
  };
  try {
    const res = await fetchResilient(`${base}/orders`, { method: "POST", headers: headers(), body: JSON.stringify(body) });
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: String((j as { message?: string }).message || `cashfree_${res.status}`) };
    const psid = (j as { payment_session_id?: string }).payment_session_id;
    if (!psid) return { ok: false, error: "no_payment_session_id" };
    return { ok: true, paymentSessionId: psid, orderId: String((j as { order_id?: string }).order_id || i.orderId), raw: j };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}

export type OrderStatus = {
  ok: boolean;
  orderStatus?: string;   // PAID | ACTIVE | EXPIRED | TERMINATED ...
  amount?: number;
  currency?: string;
  raw?: Record<string, unknown>;
  error?: string;
};

/** Authoritative server-side order status (never trust the browser return). */
export async function getOrder(orderId: string): Promise<OrderStatus> {
  const { base } = cfConfig();
  if (!cashfreeConfigured()) return { ok: false, error: "cashfree_not_configured" };
  try {
    const res = await fetchResilient(`${base}/orders/${encodeURIComponent(orderId)}`, { method: "GET", headers: headers() });
    const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: String((j as { message?: string }).message || `cashfree_${res.status}`) };
    return {
      ok: true,
      orderStatus: String((j as { order_status?: string }).order_status || ""),
      amount: Number((j as { order_amount?: number }).order_amount || 0),
      currency: String((j as { order_currency?: string }).order_currency || "INR"),
      raw: j,
    };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message || e) };
  }
}

export type OrderPayment = { paymentId: string | null; method: string | null; status: string | null; raw: Record<string, unknown> };

/** Fetch the successful payment for an order (for the receipt: payment id + method). */
export async function getSuccessfulPayment(orderId: string): Promise<OrderPayment | null> {
  const { base } = cfConfig();
  if (!cashfreeConfigured()) return null;
  try {
    const res = await fetchResilient(`${base}/orders/${encodeURIComponent(orderId)}/payments`, { method: "GET", headers: headers() });
    if (!res.ok) return null;
    const arr = (await res.json().catch(() => [])) as Record<string, unknown>[];
    const list = Array.isArray(arr) ? arr : [];
    const paid = list.find((p) => String(p.payment_status) === "SUCCESS") || list[0];
    if (!paid) return null;
    const pm = paid.payment_group || paid.payment_method;
    return {
      paymentId: paid.cf_payment_id != null ? String(paid.cf_payment_id) : null,
      method: pm != null ? String(typeof pm === "object" ? Object.keys(pm as object)[0] : pm) : null,
      status: paid.payment_status != null ? String(paid.payment_status) : null,
      raw: paid,
    };
  } catch {
    return null;
  }
}

/**
 * Verify a Cashfree webhook signature.
 * signature == base64( HMAC_SHA256( timestamp + rawBody, secretKey ) ).
 * MUST be given the exact raw (unparsed) request body.
 */
export function verifyWebhookSignature(signature: string | null, rawBody: string, timestamp: string | null): boolean {
  const { secret } = cfConfig();
  if (!secret || !signature || !timestamp) return false;
  try {
    const expected = crypto.createHmac("sha256", secret).update(timestamp + rawBody).digest("base64");
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
