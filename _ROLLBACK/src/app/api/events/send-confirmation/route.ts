import { createClient } from "@supabase/supabase-js";
import { gmailAccessToken, buildRawWithIcs, gmailSend } from "@/lib/email/gmail";
import { injectTracking } from "@/lib/email/tracking";
import { buildICS, confirmationHtml, type IcsEvent } from "@/lib/email/templates";

export const runtime = "nodejs";

/** Sends a branded confirmation + .ics invite to a signed-in registrant (their own email only). */
export async function POST(req: Request) {
  try {
    const creds = await gmailAccessToken();
    if (!creds) return Response.json({ ok: false, error: "Email not configured" }, { status: 200 });

    const { to, name, event, accessToken } = (await req.json()) as {
      to: string; name?: string; event: IcsEvent; accessToken?: string;
    };
    if (!to || !event) return Response.json({ ok: false, error: "Missing data" }, { status: 400 });

    // Gate: only a signed-in user sending to their own email may trigger a send.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (url && anon && accessToken) {
      const supa = createClient(url, anon);
      const { data, error } = await supa.auth.getUser(accessToken);
      const email = data?.user?.email;
      if (error || !email) return Response.json({ ok: false, error: "Invalid session" }, { status: 401 });
      if (email.toLowerCase() !== String(to).toLowerCase()) return Response.json({ ok: false, error: "Email mismatch" }, { status: 403 });
    } else {
      return Response.json({ ok: false, error: "Not authorized" }, { status: 401 });
    }

    const subject = `You're registered: ${event.name} \u00B7 Vedam School of Technology`;
    let html = confirmationHtml(event, name, to);
    try {
      const svcU = process.env.NEXT_PUBLIC_SUPABASE_URL!, svcK = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (svcK) { const svc = createClient(svcU, svcK);
        const { data: skip } = await svc.rpc("is_opted_out", { p_email: to, p_phone: null, p_channel: "email" });
        if (!skip) { const { data: eid } = await svc.rpc("email_event_log", { p_user: null, p_to: to, p_kind: "confirmation", p_ref_id: null, p_ref_name: `Registration — ${event?.name ?? ""}`, p_subject: subject, p_template: null, p_html: html });
          if (eid) html = injectTracking(html, eid as string, to); } }
    } catch { /* best effort */ }
    const ics = buildICS(event, to, creds.sender);
    const raw = buildRawWithIcs({ to, from: creds.sender, subject, html, ics });
    const sent = await gmailSend(creds.token, raw);
    if (!sent.ok) return Response.json({ ok: false, error: sent.error }, { status: 200 });

    // Log to the 24h quota ledger (best effort, as the signed-in user).
    if (url && anon && accessToken) {
      try {
        const supa = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${accessToken}` } } });
        await supa.rpc("log_email_sends", { p_n: 1, p_kind: "confirmation", p_event: null });
      } catch { /* ignore */ }
    }
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 200 });
  }
}
