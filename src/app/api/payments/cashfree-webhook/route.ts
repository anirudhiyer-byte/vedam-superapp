import { createClient } from "@supabase/supabase-js";
import { verifyWebhookSignature } from "@/lib/payments/cashfree";
import { confirmPayment } from "@/lib/payments/confirm";
import { confirmVsatPayment } from "@/lib/payments/vsat-confirm";
import { safeBaseUrl } from "@/lib/payments/base-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Diagnostic: confirm the route is live + the secret is present in THIS deployment. */
export async function GET() {
  return Response.json({
    ok: true, route: "cashfree-webhook",
    secretConfigured: !!process.env.CASHFREE_SECRET_KEY,
    serviceKeyConfigured: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    env: (process.env.CASHFREE_ENV || "sandbox").toLowerCase(),
  });
}

/**
 * Shared Cashfree payment webhook for BOTH event registrations and the VSAT fee.
 * One URL is registered in the Cashfree dashboard; we dispatch by the order-id
 * prefix: VSAT orders are "VSATPAY_…" (→ confirmVsatPayment), event orders are
 * "VEDPAY_…" (→ confirmPayment). Both confirmers re-verify PAID with Cashfree and
 * are idempotent. Verifies the signature against the RAW body first (bad/missing
 * → 401); everything else → 200 so Cashfree does not hammer retries.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const signature = req.headers.get("x-webhook-signature");
  const timestamp = req.headers.get("x-webhook-timestamp");

  if (!verifyWebhookSignature(signature, raw, timestamp)) {
    return new Response("invalid signature", { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svcKey) return new Response("ok", { status: 200 });

  try {
    const payload = JSON.parse(raw) as { type?: string; data?: { order?: { order_id?: string }; payment?: { cf_payment_id?: string | number } } };
    const orderId = payload?.data?.order?.order_id;
    // we only act on payment-related events; the confirmers re-verify status themselves
    if (orderId && /PAYMENT/i.test(String(payload.type || ""))) {
      const svc = createClient(url, svcKey);
      if (orderId.startsWith("VSATPAY_")) {
        const eventId = payload?.data?.payment?.cf_payment_id != null ? String(payload.data.payment.cf_payment_id) : null;
        await confirmVsatPayment(svc, orderId, eventId);
      } else {
        await confirmPayment(svc, orderId, safeBaseUrl(req));
      }
    }
  } catch { /* never 500 a webhook — Cashfree would retry; our confirmers are idempotent anyway */ }

  return new Response("ok", { status: 200 });
}
