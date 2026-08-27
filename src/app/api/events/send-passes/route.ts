import { createClient } from "@supabase/supabase-js";
import { gmailAccessToken, buildRawHtml, gmailSend } from "@/lib/email/gmail";
import { campaignShell, buttonHtml } from "@/lib/email/templates";

export const runtime = "nodejs";

/** Admin-only: email registrants a link to view/download their invite pass. */
export async function POST(req: Request) {
  try {
    const creds = await gmailAccessToken();
    if (!creds) return Response.json({ ok: false, error: "Email not configured" }, { status: 200 });

    const { recipients, origin, eventCode, eventName, accessToken } = (await req.json()) as {
      recipients: string[]; origin: string; eventCode: string; eventName?: string; accessToken?: string;
    };
    if (!Array.isArray(recipients) || recipients.length === 0 || !eventCode)
      return Response.json({ ok: false, error: "Missing recipients or event" }, { status: 400 });
    if (recipients.length > 40) return Response.json({ ok: false, error: "Batch too large (max 40)" }, { status: 400 });

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon || !accessToken) return Response.json({ ok: false, error: "Not authorized" }, { status: 401 });
    const supa = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${accessToken}` } } });
    const { data: isAdmin } = await supa.rpc("is_admin");
    if (!isAdmin) return Response.json({ ok: false, error: "Admins only" }, { status: 403 });

    const passUrl = `${origin}/pass?e=${encodeURIComponent(eventCode)}`;
    const body = `<p style="margin:0 0 14px">Your invite pass for <b style="color:#2B135C">${eventName || "the event"}</b> is ready.</p>`
      + `<p style="margin:0 0 14px">Open the link below to view and download it — show it at the entrance.</p>`
      + buttonHtml("Get your pass", passUrl);
    const html = campaignShell(body);

    let sent = 0;
    const failures: { to: string; error: string }[] = [];
    for (const to of recipients) {
      const addr = String(to || "").trim();
      if (!addr) continue;
      const raw = buildRawHtml({ to: addr, from: creds.sender, subject: `Your invite pass — ${eventName || "Vedam"}`, html });
      const r = await gmailSend(creds.token, raw);
      if (r.ok) sent++; else failures.push({ to: addr, error: r.error || "failed" });
    }
    try { await supa.rpc("log_email_sends", { p_n: sent, p_kind: "passes", p_event: null }); } catch { /* ignore */ }
    return Response.json({ ok: true, sent, failed: failures.length, failures });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 500 });
  }
}
