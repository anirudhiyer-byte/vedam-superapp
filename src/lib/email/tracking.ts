/** Inject an open-pixel + rewrite every <a href> to go through the click tracker. */
const BASE = process.env.NEXT_PUBLIC_SITE_URL || "https://one.vedam.org";

export function injectTracking(html: string, eventId: string): string {
  // rewrite links: href="X" -> href="{BASE}/api/track/click?e=<id>&u=<enc X>"
  const rewritten = html.replace(/href="(https?:\/\/[^"]+)"/gi, (_m, url) =>
    `href="${BASE}/api/track/click?e=${eventId}&u=${encodeURIComponent(url)}"`);
  // append 1x1 open pixel before </body> (or at the end)
  const pixel = `<img src="${BASE}/api/track/open?e=${eventId}" width="1" height="1" alt="" style="display:none" />`;
  return rewritten.includes("</body>") ? rewritten.replace("</body>", pixel + "</body>") : rewritten + pixel;
}
