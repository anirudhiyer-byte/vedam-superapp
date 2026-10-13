import { deliverEmail } from "@/lib/email/deliver";

/**
 * Send one email server-side (used by the comms crons — no user session needed).
 * Routes through deliverEmail so it goes via SMTP2GO (Gmail only as fallback),
 * gets an email_events row (tracking + open/click pixels) and respects opt-outs —
 * same pipeline as every other app email. No more direct Gmail sends.
 */
export async function sendEmailServer(
  to: string,
  subject: string,
  html: string,
  opts?: { kind?: string; campaignId?: string | null; userId?: string | null; refId?: string | null; refName?: string | null },
): Promise<{ ok: boolean; error?: string }> {
  const r = await deliverEmail({
    to,
    subject,
    html,
    kind: opts?.kind ?? "journey",
    campaignId: opts?.campaignId ?? null,
    userId: opts?.userId ?? null,
    refId: opts?.refId ?? null,
    refName: opts?.refName ?? null,
  });
  return { ok: r.ok, error: r.error };
}
