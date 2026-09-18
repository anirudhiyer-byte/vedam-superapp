import { createClient } from "@supabase/supabase-js";
import { gmailAccessToken, buildRawHtml, gmailSend } from "@/lib/email/gmail";
import { injectTracking } from "@/lib/email/tracking";
import { campaignShell, buttonHtml } from "@/lib/email/templates";

export const runtime = "nodejs";

/** Emails the signed-in user their CodeSprint module certificate link. */
export async function POST(req: Request) {
  try {
    const creds = await gmailAccessToken();
    if (!creds) return Response.json({ ok: false, error: "Email not configured" }, { status: 200 });
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
    const __csSubj = `Your CodeSprint certificate — ${moduleName}`;
    const __csHtml0 = campaignShell(body, "brand");
      let __html = __csHtml0;
      try {
        const __svcU = process.env.NEXT_PUBLIC_SUPABASE_URL!, __svcK = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (__svcK) { const __svc = createClient(__svcU, __svcK);
          const { data: __skip } = await __svc.rpc("is_opted_out", { p_email: user.email, p_phone: null, p_channel: "email" });
          if (!__skip) { const { data: __eid } = await __svc.rpc("email_event_log", { p_user: user.id, p_to: user.email, p_kind: "certificate", p_ref_id: null, p_ref_name: `CodeSprint certificate — ${moduleName}`, p_subject: __csSubj, p_template: null, p_html: __csHtml0 });
            if (__eid) __html = injectTracking(__csHtml0, __eid as string, user.email); } }
      } catch { /* best effort */ }
    const raw = buildRawHtml({ to: user.email, from: creds.sender, subject: __csSubj, html: __html });
    await gmailSend(creds.token, raw);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 200 });
  }
}
