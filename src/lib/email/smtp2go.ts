import { fetchResilient } from "@/lib/resilience";

/**
 * SMTP2GO HTTP API sender — the scale-safe path (no 2000/day Workspace cap,
 * real delivery/bounce events via the webhook). Configured by env:
 *   SMTP2GO_API_KEY  — the API key (already in Vercel)
 *   SMTP2GO_SENDER   — verified from-address on your SMTP2GO domain
 *                      (falls back to SENDER_EMAIL if unset)
 */
export function smtp2goConfigured(): boolean {
  return !!process.env.SMTP2GO_API_KEY && !!(process.env.SMTP2GO_SENDER || process.env.SENDER_EMAIL);
}

type Attachment = { filename: string; content: string; mimetype: string };

/**
 * Send one HTML email via SMTP2GO. Returns the provider email_id as messageId
 * (stored as email_events.provider_msg_id so the webhook can match delivery/opens).
 */
export async function smtp2goSend(opts: {
  to: string;
  subject: string;
  html: string;
  ics?: string;              // optional .ics calendar invite (raw text)
  fromName?: string;
}): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const apiKey = process.env.SMTP2GO_API_KEY;
  const senderAddr = process.env.SMTP2GO_SENDER || process.env.SENDER_EMAIL;
  if (!apiKey || !senderAddr) return { ok: false, error: "smtp2go_not_configured" };

  const sender = `${opts.fromName || "Vedam School of Technology"} <${senderAddr}>`;
  const body: Record<string, unknown> = {
    sender,
    to: [opts.to],
    subject: opts.subject,
    html_body: opts.html,
  };
  if (opts.ics) {
    body.attachments = [{
      filename: "invite.ics",
      fileblob: Buffer.from(opts.ics, "utf-8").toString("base64"),
      mimetype: "text/calendar; method=REQUEST",
    } satisfies { filename: string; fileblob: string; mimetype: string }];
  }

  try {
    const res = await fetchResilient("https://api.smtp2go.com/v3/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Smtp2go-Api-Key": apiKey },
      body: JSON.stringify(body),
    }, { breakerKey: "smtp2go" });

    const json = await res.json().catch(() => ({} as Record<string, unknown>));
    const data = (json as { data?: { succeeded?: number; failed?: number; email_id?: string; failures?: unknown } }).data;
    if (res.ok && data && (data.succeeded ?? 0) > 0) {
      return { ok: true, messageId: data.email_id };
    }
    // surface the real reason instead of swallowing it
    const err = JSON.stringify((json as { data?: unknown; error?: unknown }).error ?? data?.failures ?? json).slice(0, 300);
    return { ok: false, error: `smtp2go_rejected:${err}` };
  } catch (e) {
    return { ok: false, error: `smtp2go_error:${String((e as Error)?.message || e).slice(0, 200)}` };
  }
}

export type { Attachment };
