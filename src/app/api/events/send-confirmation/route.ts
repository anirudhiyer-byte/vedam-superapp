import { createClient } from "@supabase/supabase-js";
import { gmailAccessToken, buildRawWithIcs, gmailSend } from "@/lib/email/gmail";
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
    const html = confirmationHtml(event, name, to);
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
