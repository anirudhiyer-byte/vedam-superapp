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
 *  Short links (lnkd.in, what the phone app gives) are not valid here: their
 *  destination is unknown. The client sends them to /api/linkedin/resolve,
 *  which opens them server-side (resolveLnkdIn) and returns the real post URL.
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

/** One stable form per post, so the same post is never counted twice:
 *  https://www.linkedin.com/<path> with no query (utm_*), hash or trailing slash.
 *  Returns null if the URL is not a valid LinkedIn post URL. */
export function canonicalLinkedInPostUrl(raw: string): string | null {
  if (!isValidLinkedInPostUrl(raw)) return null;
  const u = new URL(raw.trim());
  return "https://www.linkedin.com" + u.pathname.replace(/\/+$/, "");
}

// ---------------------------------------------------------------------------
// lnkd.in short links (what the LinkedIn phone app gives when you share a post)
// ---------------------------------------------------------------------------
const LNKD_CODE = /^[A-Za-z0-9_-]{4,32}$/;

function lnkdCode(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || s.length > 200) return null;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  if (u.hostname.toLowerCase() !== "lnkd.in") return null;
  const code = u.pathname.replace(/^\//, "").replace(/\/$/, "");
  return LNKD_CODE.test(code) ? code : null;
}

/** True for https://lnkd.in/<code> (host exactly lnkd.in, simple code only). */
export function isLnkdInShortUrl(raw: string): boolean {
  return lnkdCode(raw) !== null;
}

export type ResolveResult = { ok: true; url: string } | { ok: false; reason: "invalid" | "not_a_post" | "unavailable" };
type FetchLike = (input: string, init?: { redirect?: "manual"; signal?: AbortSignal; headers?: Record<string, string> }) => Promise<Response>;

const POST_IN_HTML = /https:\/\/(?:www\.)?linkedin\.com\/(?:posts\/[A-Za-z0-9%._-]+|feed\/update\/urn:li:(?:activity|share|ugcPost):[0-9]+)/g;
const MAX_HOPS = 3;
const MAX_HTML = 200_000;

/** SERVER-ONLY. Opens a lnkd.in short link and returns the canonical LinkedIn
 *  post URL it points to.
 *
 *  SSRF-safe by construction: we only ever fetch https://lnkd.in/<code> URLs that
 *  we build ourselves; redirects are followed by hand (max 3) and we stop the
 *  moment one points anywhere other than lnkd.in — a linkedin.com post is the
 *  answer, anything else is rejected without being fetched.
 *
 *  Not a security gate: the database still validates the final URL, and a
 *  canonical post URL is something a user could paste directly anyway. */
export async function resolveLnkdIn(raw: string, fetchImpl: FetchLike = fetch as unknown as FetchLike, opts: { timeoutMs?: number } = {}): Promise<ResolveResult> {
  let code = lnkdCode(raw);
  if (!code) return { ok: false, reason: "invalid" };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 5000);
  try {
    for (let hop = 0; hop < MAX_HOPS; hop++) {
      const current = `https://lnkd.in/${code}`;
      const res = await fetchImpl(current, { redirect: "manual", signal: ctrl.signal, headers: { "user-agent": "Mozilla/5.0 (compatible; VedamLinkCheck/1.0)" } });

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return { ok: false, reason: "unavailable" };
        let next: string;
        try { next = new URL(loc, current).toString(); } catch { return { ok: false, reason: "not_a_post" }; }
        const canon = canonicalLinkedInPostUrl(next);
        if (canon) return { ok: true, url: canon };
        const nextCode = lnkdCode(next);
        if (!nextCode) return { ok: false, reason: "not_a_post" }; // leaves LinkedIn → never fetched
        code = nextCode;
        continue;
      }

      if (res.status === 200) {
        // Some lnkd.in links show a small HTML page instead of redirecting.
        const html = (await res.text()).slice(0, MAX_HTML);
        const found = new Set<string>();
        for (const m of html.match(POST_IN_HTML) ?? []) { const c = canonicalLinkedInPostUrl(m); if (c) found.add(c); }
        return found.size === 1 ? { ok: true, url: [...found][0] } : { ok: false, reason: "not_a_post" };
      }

      return { ok: false, reason: "unavailable" }; // 4xx/5xx/999 (LinkedIn bot block)
    }
    return { ok: false, reason: "unavailable" }; // too many hops / loop
  } catch {
    return { ok: false, reason: "unavailable" }; // network error or timeout
  } finally {
    clearTimeout(timer);
  }
}
