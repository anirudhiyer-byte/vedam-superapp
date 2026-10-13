import { createClient } from "@supabase/supabase-js";
import { receiptHtml } from "@/lib/payments/receipt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Owner-only payment receipt (print-ready HTML → Save as PDF). Only returns a receipt
 * for the requester's OWN order and only once it is paid.
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const orderId = sp.get("order");
  const token = sp.get("token");
  if (!orderId || !token) return new Response("missing params", { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !svcKey) return new Response("not configured", { status: 500 });

  const asUser = createClient(url, anon);
  const { data: u, error } = await asUser.auth.getUser(token);
  if (error || !u?.user?.id) return new Response("unauthorized", { status: 401 });

  const svc = createClient(url, svcKey);
  const { data: pr } = await svc.from("event_payments").select("*").eq("cf_order_id", orderId).maybeSingle();
  const p = pr as (Record<string, unknown> & { user_id: string; status: string; amount: number; currency: string; cf_payment_id: string | null; cf_payment_method: string | null; event_id: string; user_email: string | null; paid_at: string | null; answers_snapshot: { full_name?: string } | null }) | null;
  if (!p || p.user_id !== u.user.id) return new Response("not found", { status: 404 });
  if (p.status !== "paid") return new Response("Receipt available after payment is confirmed.", { status: 409 });

  const { data: ev } = await svc.from("events").select("name, event_code").eq("id", p.event_id).maybeSingle();
  const e = (ev || {}) as { name?: string; event_code?: string };
  const html = receiptHtml({
    receiptNo: "VED-RCPT-" + orderId.replace(/[^A-Za-z0-9]/g, "").slice(-8).toUpperCase(),
    orderId, paymentId: p.cf_payment_id, method: p.cf_payment_method,
    amount: Number(p.amount), currency: p.currency, payerName: p.answers_snapshot?.full_name || null,
    payerEmail: p.user_email, eventName: e.name || "Event", eventCode: e.event_code || null,
    paidAtIso: p.paid_at || new Date().toISOString(),
  });
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
