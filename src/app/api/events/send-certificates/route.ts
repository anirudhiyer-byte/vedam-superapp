import { createClient } from "@supabase/supabase-js";
import { gmailAccessToken, buildRawHtml, gmailSend } from "@/lib/email/gmail";
import { campaignShell, buttonHtml } from "@/lib/email/templates";
import { linkedInShareUrl, defaultShareText } from "@/lib/events";

export const runtime = "nodejs";

/** Admin-only: issue (get-or-create) certificates for registrations and email each a view link. */
export async function POST(req: Request) {
  try {
    const creds = await gmailAccessToken();
    if (!creds) return Response.json({ ok: false, error: "Email not configured" }, { status: 200 });

    const { registrationIds, origin, eventName, kind, position, accessToken } = (await req.json()) as {
      registrationIds: string[]; origin: string; eventName?: string; kind?: "participation" | "winner"; position?: string | null; accessToken?: string;
    };
    const certKind = kind === "winner" ? "winner" : "participation";
    const certPos = certKind === "winner" ? (position || null) : null;
    if (!Array.isArray(registrationIds) || registrationIds.length === 0)
      return Response.json({ ok: false, error: "No recipients" }, { status: 400 });
    if (registrationIds.length > 40) return Response.json({ ok: false, error: "Batch too large (max 40)" }, { status: 400 });

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon || !accessToken) return Response.json({ ok: false, error: "Not authorized" }, { status: 401 });
    const supa = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${accessToken}` } } });
    const { data: isAdmin } = await supa.rpc("is_admin");
    if (!isAdmin) return Response.json({ ok: false, error: "Admins only" }, { status: 403 });

    let sent = 0;
    const failures: { id: string; error: string }[] = [];
    for (const regId of registrationIds) {
      try {
        const { data: reg } = await supa.from("event_registrations")
          .select("id, event_id, user_id, user_email, full_name").eq("id", regId).single();
        if (!reg?.user_email) { failures.push({ id: regId, error: "no email" }); continue; }

        // get-or-create the certificate
        let certId: string;
        const { data: existing } = await supa.from("certificates").select("id").eq("registration_id", regId).eq("kind", certKind).maybeSingle();
        if (existing) { certId = existing.id; await supa.from("certificates").update({ position: certPos }).eq("id", certId); }
        else {
          const ins = await supa.from("certificates")
            .insert({ registration_id: regId, event_id: reg.event_id, user_id: reg.user_id, kind: certKind, position: certPos })
            .select("id").single();
          if (ins.error) { failures.push({ id: regId, error: ins.error.message.slice(0, 120) }); continue; }
          certId = ins.data.id;
        }

        const certUrl = `${origin}/certificate?c=${certId}`;
        const shareBtn = `<div style="text-align:center;margin:10px 0 4px"><a href="${linkedInShareUrl(certUrl)}" style="display:inline-block;background:#0A66C2;color:#fff;text-decoration:none;font:800 14px Arial,sans-serif;padding:12px 30px;border-radius:11px">Share on LinkedIn</a></div>`;
        const intro = certKind === "winner"
          ? `<p style="margin:0 0 14px">Huge congratulations — you <b style="color:#B8860B">won</b> <b style="color:#2B135C">${eventName || "the event"}</b> at Vedam School of Technology! Your Certificate of Excellence is ready.</p>`
          : `<p style="margin:0 0 14px">Congratulations on completing <b style="color:#2B135C">${eventName || "the bootcamp"}</b> with Vedam School of Technology. Your Certificate of Participation is ready.</p>`;
        const body = `<p style="margin:0 0 14px">Hi ${reg.full_name || "there"},</p>` + intro
          + buttonHtml("View your certificate", certUrl)
          + `<p style="margin:16px 0 6px;text-align:center;color:#7a7790;font:400 13px Arial,sans-serif">Proud of it? Share it with your network.</p>`
          + shareBtn;
        const subject = certKind === "winner" ? `🏆 You won — ${eventName || "Vedam"}` : `Your certificate — ${eventName || "Vedam"}`;
        const raw = buildRawHtml({ to: reg.user_email, from: creds.sender, subject, html: campaignShell(body) });
        const r = await gmailSend(creds.token, raw);
        if (r.ok) sent++; else failures.push({ id: regId, error: r.error || "send failed" });
      } catch (e) {
        failures.push({ id: regId, error: String((e as Error)?.message || e).slice(0, 120) });
      }
    }
    try { await supa.rpc("log_email_sends", { p_n: sent, p_kind: certKind === "winner" ? "winner_certificates" : "certificates", p_event: null }); } catch { /* ignore */ }
    return Response.json({ ok: true, sent, failed: failures.length, failures });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 500 });
  }
}
