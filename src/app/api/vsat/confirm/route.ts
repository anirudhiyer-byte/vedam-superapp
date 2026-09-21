import { createClient } from "@supabase/supabase-js";
import { gmailAccessToken, gmailSend, buildRawHtml } from "@/lib/email/gmail";
import { campaignShell } from "@/lib/email/shell";

export const runtime = "nodejs";

/** Sends the VSAT interest confirmation to the registrant's email on file
 *  (profiles.email) — regardless of whether the email is verified yet. */
export async function POST(req: Request) {
  try {
    const creds = await gmailAccessToken();
    if (!creds) return Response.json({ ok: false, error: "Email not configured" }, { status: 200 });
    const { accessToken } = (await req.json()) as { accessToken?: string };

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !anon || !accessToken) return Response.json({ ok: false, error: "Not authorized" }, { status: 401 });
    // validate the session -> get the user id
    const supa = createClient(url, anon);
    const { data: u, error: uErr } = await supa.auth.getUser(accessToken);
    if (uErr || !u?.user?.id) return Response.json({ ok: false, error: "Invalid session" }, { status: 401 });

    // authoritative recipient = the user's own profiles.email (verified or not)
    const svc = svcKey ? createClient(url, svcKey) : supa;
    const { data: prof } = await svc.from("profiles").select("email, full_name").eq("id", u.user.id).maybeSingle();
    const to = (prof as { email?: string; full_name?: string } | null)?.email || u.user.email || undefined;
    const name = (prof as { full_name?: string } | null)?.full_name;
    if (!to) return Response.json({ ok: false, error: "No email on file for this account" }, { status: 200 });

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
    return Response.json({ ok: sent.ok, to, error: sent.ok ? undefined : sent.error }, { status: 200 });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 200 });
  }
}
