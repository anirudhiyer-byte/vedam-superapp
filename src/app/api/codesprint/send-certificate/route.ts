import { createClient } from "@supabase/supabase-js";
import { gmailAccessToken, buildRawHtml, gmailSend } from "@/lib/email/gmail";
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
    const raw = buildRawHtml({ to: user.email, from: creds.sender, subject: `Your CodeSprint certificate — ${moduleName}`, html: campaignShell(body, "brand") });
    await gmailSend(creds.token, raw);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 200 });
  }
}
