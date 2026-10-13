import { createClient } from "@supabase/supabase-js";
import { deliverEmail } from "@/lib/email/deliver";
export const runtime = "nodejs";

/** Sends a rendered email template to the admin's own address for preview. */
export async function POST(req: Request) {
  try {
    const { html, subject, accessToken } = (await req.json()) as { html: string; subject: string; accessToken?: string };
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon || !accessToken) return Response.json({ ok: false, error: "Not authorized" }, { status: 401 });
    const supa = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${accessToken}` } } });
    const { data: u } = await supa.auth.getUser(accessToken);
    if (!u?.user?.email) return Response.json({ ok: false, error: "Invalid session" }, { status: 401 });
    const { data: isAdmin } = await supa.rpc("is_admin");
    if (!isAdmin) return Response.json({ ok: false, error: "Admins only" }, { status: 403 });

    const r = await deliverEmail({ to: u.user.email, subject: `[TEST] ${subject || "Template preview"}`, html, kind: "test", userId: u.user.id });
    return Response.json({ ok: r.ok, to: u.user.email, error: r.ok ? undefined : r.error }, { status: 200 });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 200 });
  }
}
