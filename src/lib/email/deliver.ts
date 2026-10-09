import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { injectTracking } from "@/lib/email/tracking";
import { smtp2goConfigured, smtp2goSend } from "@/lib/email/smtp2go";
import { gmailAccessToken, buildRawHtml, buildRawWithIcs, gmailSend } from "@/lib/email/gmail";

/** A service-role client (bypasses RLS) for logging + opt-out checks. */
function svcClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key) : null;
}

export type DeliverResult = { ok: boolean; skipped?: boolean; provider?: "smtp2go" | "gmail"; error?: string };

/**
 * Single entry point for every app email. Prefers SMTP2GO (scale-safe, tracked),
 * falls back to Gmail only if SMTP2GO isn't configured. ALWAYS writes a per-recipient
 * email_events row, injects open/click tracking, captures the provider message id, and
 * on failure marks the row `failed` + returns the error — no silent catch.
 */
export async function deliverEmail(opts: {
  to: string;
  subject: string;
  html: string;
  kind: string;
  ics?: string;
  userId?: string | null;
  refId?: string | null;
  refName?: string | null;
  campaignId?: string | null;
  fromName?: string;
}): Promise<DeliverResult> {
  const svc = svcClient();
  if (!svc) return { ok: false, error: "service_role_key_missing" };

  // never mail an opted-out address
  try {
    const { data: skip } = await svc.rpc("is_opted_out", { p_email: opts.to, p_phone: null, p_channel: "email" });
    if (skip) return { ok: true, skipped: true };
  } catch { /* if the check itself errors, continue — better to send than to drop */ }

  // 1) per-recipient row (source of truth for tracking) + inject the tracking pixel/links
  let eid: string | null = null;
  try {
    // IMPORTANT: always pass p_campaign (the 9th arg). Two email_event_log
    // overloads exist (8-arg and 9-arg); an 8-arg call matches BOTH and Postgres
    // errors "function is not unique" — which silently killed all email logging.
    // Passing p_campaign forces a unique match on the 9-arg overload.
    const { data } = await svc.rpc("email_event_log", {
      p_user: opts.userId ?? null, p_to: opts.to, p_kind: opts.kind,
      p_ref_id: opts.refId ?? null, p_ref_name: opts.refName ?? null,
      p_subject: opts.subject, p_template: null, p_html: opts.html,
      p_campaign: opts.campaignId ?? null,
    });
    if (data) eid = data as string;
  } catch (e) {
    // logging must not be silent — surface it, but still attempt the send
    console.error("[deliverEmail] email_event_log failed:", String((e as Error)?.message || e));
  }
  const html = eid ? injectTracking(opts.html, eid, opts.to) : opts.html;

  // 2) send — SMTP2GO first, Gmail only as fallback
  let sent: { ok: boolean; messageId?: string; error?: string };
  let provider: "smtp2go" | "gmail";
  if (smtp2goConfigured()) {
    provider = "smtp2go";
    sent = await smtp2goSend({ to: opts.to, subject: opts.subject, html, ics: opts.ics, fromName: opts.fromName });
  } else {
    provider = "gmail";
    const creds = await gmailAccessToken();
    if (!creds) sent = { ok: false, error: "no_email_provider_configured" };
    else {
      const raw = opts.ics
        ? buildRawWithIcs({ to: opts.to, from: creds.sender, subject: opts.subject, html, ics: opts.ics })
        : buildRawHtml({ to: opts.to, from: creds.sender, subject: opts.subject, html });
      const r = await gmailSend(creds.token, raw);
      sent = { ok: r.ok, error: r.error };
    }
  }

  // 3) record outcome on the row — success stamps provider id, failure marks it failed
  try {
    if (sent.ok && eid && sent.messageId) {
      await svc.rpc("email_set_msgid", { p_id: eid, p_msgid: sent.messageId });
    } else if (!sent.ok && eid) {
      await svc.from("email_events").update({ status: "failed" }).eq("id", eid);
    }
  } catch { /* outcome-stamp best effort; the return value below is the real signal */ }

  if (!sent.ok) {
    console.error(`[deliverEmail] ${provider} send failed to ${opts.to} (${opts.kind}): ${sent.error}`);
    return { ok: false, provider, error: sent.error };
  }
  return { ok: true, provider };
}
