import { createClient } from "@supabase/supabase-js";
import { readVsatMoneyFlags, computeVsatFee } from "@/lib/payments/vsat-fee";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Server-authoritative fee quote for the logged-in applicant, so the dashboard can
 * render the 24-hour early-bird banner and the exact pay amount without ever
 * trusting a client-side number. Read-only.
 */
export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !svcKey) return Response.json({ ok: false, error: "not configured" }, { status: 500 });
  let b: { accessToken?: string }; try { b = await req.json(); } catch { return Response.json({ ok: false }, { status: 400 }); }
  if (!b.accessToken) return Response.json({ ok: false, error: "Not authorized" }, { status: 401 });

  const asUser = createClient(url, anon);
  const { data: u, error: uErr } = await asUser.auth.getUser(b.accessToken);
  if (uErr || !u?.user?.id) return Response.json({ ok: false, error: "Invalid session" }, { status: 401 });

  const svc = createClient(url, svcKey);
  const { data: app } = await svc.from("application_manager").select("created_at").eq("lead_id", u.user.id).maybeSingle();
  const flags = await readVsatMoneyFlags(svc);
  const fee = computeVsatFee({ fee: flags.fee, discount24h: flags.discount24h, applicantCreatedAt: (app as { created_at?: string } | null)?.created_at });
  return Response.json({ ok: true, ...fee });
}
