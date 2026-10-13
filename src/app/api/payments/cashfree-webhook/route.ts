import { createClient } from "@supabase/supabase-js";
import { verifyWebhookSignature } from "@/lib/payments/cashfree";
import { confirmPayment } from "@/lib/payments/confirm";

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
 * Cashfree payment webhook. Verifies the signature against the RAW body, then confirms
 * the order server-side (confirmPayment re-verifies PAID with Cashfree + is idempotent).
 * Bad signature → 401 (rejected). Everything else → 200 so Cashfree doesn't hammer retries.
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
    const payload = JSON.parse(raw) as { type?: string; data?: { order?: { order_id?: string } } };
    const orderId = payload?.data?.order?.order_id;
    // we only act on payment-related events; confirmPayment itself re-verifies status
    if (orderId && /PAYMENT/i.test(String(payload.type || ""))) {
      const svc = createClient(url, svcKey);
      await confirmPayment(svc, orderId);
    }
  } catch { /* never 500 a webhook — Cashfree would retry; our confirm is idempotent anyway */ }

  return new Response("ok", { status: 200 });
}
