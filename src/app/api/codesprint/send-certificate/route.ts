import { createClient } from "@supabase/supabase-js";
import { deliverEmail } from "@/lib/email/deliver";
import { campaignShell, buttonHtml } from "@/lib/email/templates";

export const runtime = "nodejs";

/** Emails the signed-in user their CodeSprint module certificate link. */
export async function POST(req: Request) {
  try {
    const { certId, moduleName, origin, accessToken } = (await req.json()) as { certId: string; moduleName: string; origin: string; accessToken?: string };
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const supa = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${accessToken}` } } });
    const { data: { user } } = await supa.auth.getUser();
    if (!user?.email) return Response.json({ ok: false, error: "not authenticated" }, { status: 200 });

    const viewUrl = `${origin}/certificate?c=${certId}`;
    const body = `<p style="margin:0 0 14px">Congratulations! 🎉</p>
      <p style="margin:0 0 14px">You've completed <b>${moduleName}</b> in <b>CodeSprint</b> and earned your Certificate of Completion.</p>
      <p style="margin:0 0 14px">Show it off on your college and internship applications — and share it on LinkedIn to earn bonus points.</p>`
      + buttonHtml("View &amp; download your certificate", viewUrl);
    const subject = `Your CodeSprint certificate — ${moduleName}`;
    const html = campaignShell(body, "brand");

    const r = await deliverEmail({
      to: user.email, subject, html, kind: "certificate",
      userId: user.id, refName: `CodeSprint certificate — ${moduleName}`,
    });
    if (!r.ok) return Response.json({ ok: false, error: r.error || "send failed" }, { status: 200 });

    try { await createClient(url, anon, { global: { headers: { Authorization: `Bearer ${accessToken}` } } }).rpc("log_email_sends", { p_n: 1, p_kind: "certificate", p_event: null }); } catch { /* */ }
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 200 });
  }
}
