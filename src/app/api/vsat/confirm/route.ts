import { createClient } from "@supabase/supabase-js";
import { gmailAccessToken, gmailSend, buildRawHtml } from "@/lib/email/gmail";
import { campaignShell } from "@/lib/email/shell";

export const runtime = "nodejs";

/** Sends the VSAT interest confirmation to the signed-in user's own email. */
export async function POST(req: Request) {
  try {
    const creds = await gmailAccessToken();
    if (!creds) return Response.json({ ok: false, error: "Email not configured" }, { status: 200 });
    const { to, name, accessToken } = (await req.json()) as { to: string; name?: string; accessToken?: string };
    if (!to) return Response.json({ ok: false, error: "Missing data" }, { status: 400 });

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (url && anon && accessToken) {
      const supa = createClient(url, anon);
      const { data, error } = await supa.auth.getUser(accessToken);
      const email = data?.user?.email;
      if (error || !email) return Response.json({ ok: false, error: "Invalid session" }, { status: 401 });
      if (email.toLowerCase() !== String(to).toLowerCase()) return Response.json({ ok: false, error: "Email mismatch" }, { status: 403 });
    } else return Response.json({ ok: false, error: "Not authorized" }, { status: 401 });

    const subject = "You're registered for VSAT · Vedam School of Technology";
    const body = `
      <h1 style="margin:0 0 12px;font-size:24px;color:#111">You're registered for VSAT 🎉</h1>
      <p style="margin:0 0 12px;font-size:15px;color:#333">Hi ${name || "there"},</p>
      <p style="margin:0 0 12px;font-size:15px;color:#333">Thanks for registering your interest in VSAT (Vedam Scholastic Aptitude Test) for the 2026–27 cycle. You're now an early registrant.</p>
      <p style="margin:0 0 12px;font-size:15px;color:#333">Once we go live with admissions, you'll receive updates — including your early-registrant benefits (concession on VSAT fee, higher scholarship assessment, and limited early-intake seats).</p>
      <p style="margin:0;font-size:14px;color:#666">No admission commitment required. We'll notify you when the 2027 admission cycle opens.</p>`;
    const html = campaignShell(body, "brand");
    const raw = buildRawHtml({ to, from: creds.sender, subject, html });
    const sent = await gmailSend(creds.token, raw);
    return Response.json({ ok: sent.ok, error: sent.ok ? undefined : sent.error }, { status: 200 });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 200 });
  }
}
