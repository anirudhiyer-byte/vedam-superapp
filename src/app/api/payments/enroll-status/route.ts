import { createClient } from "@supabase/supabase-js";
import { confirmEnrollment } from "@/lib/payments/enroll-confirm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Synchronous confirmation for the Cashfree return URL after the enrollment
 * payment. The dashboard lands on /vsat/dashboard?pay=enroll_return&order=… and
 * calls this to settle immediately. Idempotent; the order must belong to the user.
 */
export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !svcKey) return Response.json({ ok: false, error: "not configured" }, { status: 500 });

  let b: { accessToken?: string; orderId?: string };
  try { b = await req.json(); } catch { return Response.json({ ok: false, error: "bad request" }, { status: 400 }); }
  if (!b.accessToken || !b.orderId) return Response.json({ ok: false, error: "Not authorized" }, { status: 401 });

  const asUser = createClient(url, anon);
  const { data: u, error: uErr } = await asUser.auth.getUser(b.accessToken);
  if (uErr || !u?.user?.id) return Response.json({ ok: false, error: "Invalid session" }, { status: 401 });

  const svc = createClient(url, svcKey);
  const { data: own } = await svc.from("vsat_payment_orders").select("lead_id").eq("cf_order_id", b.orderId).maybeSingle();
  if (!own || (own as { lead_id: string }).lead_id !== u.user.id) {
    return Response.json({ ok: false, error: "not_your_order" }, { status: 403 });
  }

  const res = await confirmEnrollment(svc, b.orderId);
  return Response.json({ ok: res.ok, status: res.status, error: res.error });
}
