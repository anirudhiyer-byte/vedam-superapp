import { createClient } from "@supabase/supabase-js";
export const dynamic = "force-dynamic";

/** Delete UNVERIFIED, no-activity ghost accounts that already own the phone/email
 *  a fresh signup is using — so switching contact details mid-signup doesn't 422.
 *  Only ever deletes accounts that find_signup_ghosts returns (unverified + no
 *  activity), so a real/verified user can never be removed. */
export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !svc) return Response.json({ ok: false, error: "not configured" }, { status: 500 });
  let body: { phone?: string; email?: string };
  try { body = await req.json(); } catch { return Response.json({ ok: false, error: "bad request" }, { status: 400 }); }
  const phone = (body.phone || "").trim(), email = (body.email || "").trim();
  if (!phone && !email) return Response.json({ ok: true, reclaimed: 0 });

  const admin = createClient(url, svc);
  const { data: ids, error } = await admin.rpc("find_signup_ghosts", { p_phone: phone || null, p_email: email || null });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  let reclaimed = 0;
  for (const id of (ids as string[] ?? [])) {
    try { const { error: delErr } = await admin.auth.admin.deleteUser(id); if (!delErr) reclaimed++; } catch { /* skip */ }
  }
  return Response.json({ ok: true, reclaimed });
}
