import { OAuth2Client } from "google-auth-library";

/** Returns a Gmail API access token from the service refresh token, or null if unconfigured. */
export async function gmailAccessToken(): Promise<{ token: string; sender: string } | null> {
  const sender = process.env.SENDER_EMAIL;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!sender || !clientId || !clientSecret || !refreshToken) return null;
  const oauth = new OAuth2Client(clientId, clientSecret);
  oauth.setCredentials({ refresh_token: refreshToken });
  const { token } = await oauth.getAccessToken();
  if (!token) return null;
  return { token, sender };
}

export function encodeSubject(s: string): string {
  return /[^\x00-\x7F]/.test(s)
    ? "=?UTF-8?B?" + Buffer.from(s, "utf-8").toString("base64") + "?="
    : s;
}

const b64url = (buf: Buffer) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** Simple HTML email (no attachment). */
export function buildRawHtml({ to, from, subject, html }: { to: string; from: string; subject: string; html: string }): string {
  const msg = [
    `From: Vedam School of Technology <${from}>`,
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    html,
  ].join("\r\n");
  return b64url(Buffer.from(msg, "utf-8"));
}

/** HTML email + .ics calendar attachment. */
export function buildRawWithIcs({ to, from, subject, html, ics }: { to: string; from: string; subject: string; html: string; ics: string }): string {
  const boundary = "vedam_" + Math.random().toString(36).slice(2);
  const wrap = (s: string) => Buffer.from(s, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  const msg = [
    `From: Vedam School of Technology <${from}>`,
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap(html),
    "",
    `--${boundary}`,
    'Content-Type: text/calendar; charset="UTF-8"; method=REQUEST; name="invite.ics"',
    "Content-Transfer-Encoding: base64",
    'Content-Disposition: attachment; filename="invite.ics"',
    "",
    wrap(ics),
    "",
    `--${boundary}--`,
  ].join("\r\n");
  return b64url(Buffer.from(msg));
}

export async function gmailSend(token: string, raw: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  if (res.ok) return { ok: true };
  return { ok: false, error: (await res.text()).slice(0, 200) };
}
