import { createClient } from "@supabase/supabase-js";
import { vsatReceiptHtml } from "@/lib/payments/vsat-receipt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Owner-only VSAT receipt (print-ready HTML → Save as PDF). Returns a receipt only for
 * the requester's OWN paid order (VSAT fee or enrollment). Amounts come from the server
 * ledger, never the client.
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const orderId = sp.get("order");
  const token = sp.get("token");
  if (!orderId || !token) return new Response("missing params", { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !svcKey) return new Response("not configured", { status: 500 });

  const asUser = createClient(url, anon);
  const { data: u, error } = await asUser.auth.getUser(token);
  if (error || !u?.user?.id) return new Response("unauthorized", { status: 401 });

  const svc = createClient(url, svcKey);
  const { data: or } = await svc
    .from("vsat_payment_orders")
    .select("cf_order_id, lead_id, user_email, attempt, base_amount, discount, discount_coupon, amount, currency, status, cf_payment_id, cf_payment_method, kind, updated_at, created_at")
    .eq("cf_order_id", orderId)
    .maybeSingle();
  const o = or as
    | (Record<string, unknown> & {
        lead_id: string; status: string; kind: string; attempt: number;
        base_amount: number; discount: number; discount_coupon: string | null;
        amount: number; currency: string; cf_payment_id: string | null;
        cf_payment_method: string | null; user_email: string | null;
        updated_at: string | null; created_at: string | null;
      })
    | null;
  if (!o || o.lead_id !== u.user.id) return new Response("not found", { status: 404 });
  if (o.status !== "paid") return new Response("Receipt available after payment is confirmed.", { status: 409 });

  // payer identity + accurate paid-at, from the user's own rows
  const { data: am } = await svc
    .from("application_manager")
    .select("registered_name, registered_email, enrollment_paid_at")
    .eq("lead_id", o.lead_id)
    .maybeSingle();
  const a = (am || {}) as { registered_name?: string | null; registered_email?: string | null; enrollment_paid_at?: string | null };

  let paidAt: string | null = o.updated_at || o.created_at;
  if (o.kind === "enrollment") {
    paidAt = a.enrollment_paid_at || paidAt;
  } else {
    const { data: vp } = await svc.from("vsat_payments").select("paid_at").eq("payment_ref", orderId).maybeSingle();
    paidAt = (vp as { paid_at?: string } | null)?.paid_at || paidAt;
  }

  const isEnroll = o.kind === "enrollment";
  const itemLabel = isEnroll ? "Vedam Enrollment" : "VSAT Registration";
  const feeNote = isEnroll
    ? "Seat-blocking enrollment fee"
    : `Registration fee${Number(o.attempt) > 1 ? ` · Attempt ${o.attempt}` : ""}`;
  const receiptNo = `${isEnroll ? "VED-ENR-" : "VED-VSAT-"}${orderId.replace(/[^A-Za-z0-9]/g, "").slice(-8).toUpperCase()}`;

  const html = vsatReceiptHtml({
    receiptNo,
    orderId,
    paymentId: o.cf_payment_id,
    method: o.cf_payment_method,
    baseAmount: Number(o.base_amount),
    discount: Number(o.discount),
    coupon: o.discount_coupon,
    amount: Number(o.amount),
    currency: o.currency,
    payerName: a.registered_name || null,
    payerEmail: a.registered_email || o.user_email || null,
    itemLabel,
    feeNote,
    paidAtIso: paidAt || new Date().toISOString(),
  });
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
