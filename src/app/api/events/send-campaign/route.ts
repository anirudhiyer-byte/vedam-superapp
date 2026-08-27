import { createClient } from "@supabase/supabase-js";
import { gmailAccessToken, buildRawHtml, gmailSend } from "@/lib/email/gmail";
import { campaignShell } from "@/lib/email/templates";

export const runtime = "nodejs";

/** Admin-only batch campaign send to a list of recipients (max 40 per call). */
export async function POST(req: Request) {
  try {
    const creds = await gmailAccessToken();
    if (!creds) return Response.json({ ok: false, error: "Email not configured" }, { status: 200 });

    const { subject, body, recipients, accessToken } = (await req.json()) as {
      subject: string; body: string; recipients: string[]; accessToken?: string;
    };
    if (!subject || !body || !Array.isArray(recipients) || recipients.length === 0)
      return Response.json({ ok: false, error: "Missing subject, body, or recipients" }, { status: 400 });
    if (recipients.length > 40)
      return Response.json({ ok: false, error: "Batch too large (max 40 per request)" }, { status: 400 });

    // Gate: only a signed-in admin may send a campaign (RBAC via is_admin()).
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon || !accessToken) return Response.json({ ok: false, error: "Not authorized" }, { status: 401 });
    const supa = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${accessToken}` } } });
    const { data: u, error: uerr } = await supa.auth.getUser(accessToken);
    if (uerr || !u?.user) return Response.json({ ok: false, error: "Invalid session" }, { status: 401 });
    const { data: isAdmin } = await supa.rpc("is_admin");
    if (!isAdmin) return Response.json({ ok: false, error: "Admins only" }, { status: 403 });

    const html = campaignShell(body);
    let sent = 0;
    const failures: { to: string; error: string }[] = [];
    for (const to of recipients) {
      const addr = String(to || "").trim();
      if (!addr) continue;
      const raw = buildRawHtml({ to: addr, from: creds.sender, subject, html });
      const r = await gmailSend(creds.token, raw);
      if (r.ok) sent++; else failures.push({ to: addr, error: r.error || "failed" });
    }
    try { await supa.rpc("log_email_sends", { p_n: sent, p_kind: "campaign", p_event: null }); } catch { /* ignore */ }
    return Response.json({ ok: true, sent, failed: failures.length, failures });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 500 });
  }
}
