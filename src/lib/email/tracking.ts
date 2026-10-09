import { sign } from "@/lib/security/sign";

/** Inject an open-pixel + rewrite every <a href> to go through the click tracker. */
const BASE = process.env.NEXT_PUBLIC_SITE_URL || "https://one.vedam.org";

export function injectTracking(html: string, eventId: string, toEmail?: string): string {
  // sign the event id so forged open/click hits can't spoof stats (active once UNSUB_SECRET is set)
  const sig = process.env.UNSUB_SECRET ? `&s=${sign(eventId, process.env.UNSUB_SECRET)}` : "";
  // rewrite links: href="X" -> href="{BASE}/api/track/click?e=<id>[&s=<sig>]&u=<enc X>"
  const rewritten = html.replace(/href="(https?:\/\/[^"]+)"/gi, (_m, url) =>
    `href="${BASE}/api/track/click?e=${eventId}${sig}&u=${encodeURIComponent(url)}"`);
  // append 1x1 open pixel before </body> (or at the end)
  const pixel = `<img src="${BASE}/api/track/open?e=${eventId}${sig}" width="1" height="1" alt="" style="display:none" />`;
  const unsubTok = toEmail && process.env.UNSUB_SECRET ? `&t=${sign(toEmail, process.env.UNSUB_SECRET)}` : "";
  const unsub = toEmail ? `<div style="text-align:center;padding:14px 0;font:400 11px Arial,sans-serif;color:#999">Don't want these? <a href="${BASE}/api/email/unsubscribe?e=${encodeURIComponent(toEmail)}${unsubTok}" style="color:#999;text-decoration:underline">Unsubscribe</a></div>` : "";
  const tail = pixel + unsub;
  return rewritten.includes("</body>") ? rewritten.replace("</body>", tail + "</body>") : rewritten + tail;
}
