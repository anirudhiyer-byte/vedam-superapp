import { gmailAccessToken, buildRawHtml, gmailSend } from "@/lib/email/gmail";

/** Send one email server-side (used by crons — no user session needed). */
export async function sendEmailServer(to: string, subject: string, html: string): Promise<{ ok: boolean; error?: string }> {
  const creds = await gmailAccessToken();
  if (!creds) return { ok: false, error: "email not configured" };
  const raw = buildRawHtml({ to, from: creds.sender, subject, html });
  return gmailSend(creds.token, raw);
}
