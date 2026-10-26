/** Hostname-based validation for a LinkedIn *post* URL (SEC-08 / CS-02 fix).
 *
 *  The old check tested whether the string merely *contained* "linkedin.com/",
 *  so `https://example.com/?ref=linkedin.com/x` passed. This parses the URL and
 *  verifies the real host, scheme and path — a text match alone is not enough.
 *
 *  Accepts only:
 *    - https:// (no http, no other scheme)
 *    - host exactly linkedin.com or www.linkedin.com (no sub-domains,
 *      look-alikes, userinfo tricks, ports or trailing dots)
 *    - a real post path: /posts/<slug> or /feed/update/urn:li:(activity|share|ugcPost):<digits>
 *
 *  Short links (lnkd.in) are rejected on purpose: their destination can't be
 *  checked here, so the user is asked for the full post link.
 *
 *  The database function public.is_valid_linkedin_post_url(text) applies the
 *  same rule server-side; this client copy only gives earlier feedback. */
const POST_PATH = /^\/posts\/[A-Za-z0-9%._-]+\/?$/;
const FEED_PATH = /^\/feed\/update\/urn:li:(activity|share|ugcPost):[0-9]+\/?$/;

export function isValidLinkedInPostUrl(raw: string): boolean {
  if (typeof raw !== "string") return false;
  const s = raw.trim();
  if (!s || s.length > 500) return false;

  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return false;
  }

  if (u.protocol !== "https:") return false;
  if (u.username || u.password) return false; // reject userinfo tricks
  if (u.port) return false; // default port only
  const host = u.hostname.toLowerCase();
  if (host !== "linkedin.com" && host !== "www.linkedin.com") return false;

  return POST_PATH.test(u.pathname) || FEED_PATH.test(u.pathname);
}
