import { createClient } from "@supabase/supabase-js";
import { verifyWebhookSignature } from "@/lib/payments/cashfree";
import { confirmVsatPayment } from "@/lib/payments/vsat-confirm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Diagnostic: confirm the route is live + the secret is present in THIS deployment. */
export async function GET() {
  return Response.json({
    ok: true, route: "vsat-webhook",
    secretConfigured: !!process.env.CASHFREE_SECRET_KEY,
    serviceKeyConfigured: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    env: (process.env.CASHFREE_ENV || "sandbox").toLowerCase(),
  });
}

/**
 * Cashfree VSAT payment webhook — the only place (besides the status return route)
 * that confirms a VSAT payment. Verifies the signature against the RAW body first
 * (bad/missing signature → 401, no DB access), then confirmVsatPayment re-verifies
 * PAID with Cashfree and is idempotent. Everything else → 200 so Cashfree does not
 * hammer retries; errors are logged, never returned.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const signature = req.headers.get("x-webhook-signature");
  const timestamp = req.headers.get("x-webhook-timestamp");

  if (!verifyWebhookSignature(signature, raw, timestamp)) {
    return new Response("invalid signature", { status: 401 });
  }
  // reject stale webhooks (> 5 min) — replay protection
  if (timestamp) {
    const ts = Number(timestamp) * (String(timestamp).length <= 10 ? 1000 : 1);
    if (Number.isFinite(ts) && Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
      return new Response("ok", { status: 200 });
    }
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svcKey) return new Response("ok", { status: 200 });

  try {
    const payload = JSON.parse(raw) as { type?: string; data?: { order?: { order_id?: string }; payment?: { cf_payment_id?: string | number } } };
    const orderId = payload?.data?.order?.order_id;
    const eventId = payload?.data?.payment?.cf_payment_id != null ? String(payload.data.payment.cf_payment_id) : null;
    if (orderId && /PAYMENT/i.test(String(payload.type || ""))) {
      const svc = createClient(url, svcKey);
      await confirmVsatPayment(svc, orderId, eventId);
    }
  } catch { /* never 500 a webhook — Cashfree would retry; confirm is idempotent anyway */ }

  return new Response("ok", { status: 200 });
}
