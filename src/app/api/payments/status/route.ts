import { createClient } from "@supabase/supabase-js";
import { confirmPayment } from "@/lib/payments/confirm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Owner-only payment status for the return screen. Re-runs the idempotent confirm
 * (so a paid order is finalised even if the webhook never reached us — e.g. on
 * Vercel-auth-gated preview deploys), then reports the current state to the UI.
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const orderId = sp.get("order");
  const token = sp.get("token");
  if (!orderId || !token) return Response.json({ ok: false, error: "missing params" }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !svcKey) return Response.json({ ok: false, error: "not configured" }, { status: 500 });

  const asUser = createClient(url, anon);
  const { data: u, error } = await asUser.auth.getUser(token);
  if (error || !u?.user?.id) return Response.json({ ok: false, error: "Invalid session" }, { status: 401 });

  const svc = createClient(url, svcKey);
  // ownership check — a user can only query their own order
  const { data: pr } = await svc.from("event_payments").select("user_id, status, event_id").eq("cf_order_id", orderId).maybeSingle();
  const p = pr as { user_id: string; status: string; event_id: string } | null;
  if (!p || p.user_id !== u.user.id) return Response.json({ ok: false, error: "not found" }, { status: 404 });

  const res = await confirmPayment(svc, orderId);
  const paid = res.ok && (res.status === "paid" || res.status === "already_paid");
  return Response.json({ ok: true, paid, status: res.status });
}
