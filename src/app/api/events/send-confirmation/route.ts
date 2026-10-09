import { createClient } from "@supabase/supabase-js";
import { deliverEmail } from "@/lib/email/deliver";
import { buildICS, confirmationHtml, type IcsEvent } from "@/lib/email/templates";

export const runtime = "nodejs";

/** Sends a branded confirmation + .ics invite to a signed-in registrant (their own email only). */
export async function POST(req: Request) {
  try {
    const { to, name, event, accessToken } = (await req.json()) as {
      to: string; name?: string; event: IcsEvent; accessToken?: string;
    };
    if (!to || !event) return Response.json({ ok: false, error: "Missing data" }, { status: 400 });

    // Gate: only a signed-in user sending to their own email may trigger a send.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!(url && anon && accessToken)) return Response.json({ ok: false, error: "Not authorized" }, { status: 401 });
    const supa = createClient(url, anon);
    const { data, error } = await supa.auth.getUser(accessToken);
    const email = data?.user?.email;
    if (error || !email) return Response.json({ ok: false, error: "Invalid session" }, { status: 401 });
    if (email.toLowerCase() !== String(to).toLowerCase()) return Response.json({ ok: false, error: "Email mismatch" }, { status: 403 });

    const senderAddr = process.env.SMTP2GO_SENDER || process.env.SENDER_EMAIL || "connect@vedamcoms.org";
    const subject = `You're registered: ${event.name} · Vedam School of Technology`;
    const html = confirmationHtml(event, name, to);
    const ics = buildICS(event, to, senderAddr);

    // deliverEmail: SMTP2GO (scale-safe) → Gmail fallback, logs email_events, fails loud.
    const r = await deliverEmail({
      to, subject, html, kind: "confirmation", ics,
      userId: data.user?.id ?? null, refName: `Registration — ${event?.name ?? ""}`,
    });
    if (!r.ok) return Response.json({ ok: false, error: r.error || "send failed" }, { status: 200 });

    // 24h quota ledger (best effort, as the signed-in user).
    try {
      const s = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${accessToken}` } } });
      await s.rpc("log_email_sends", { p_n: 1, p_kind: "confirmation", p_event: null });
    } catch { /* ignore */ }
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 200 });
  }
}
