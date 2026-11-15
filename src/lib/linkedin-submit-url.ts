import { canonicalLinkedInPostUrl, isLnkdInShortUrl } from "@/lib/linkedin-url";

export const LINKEDIN_URL_ERROR = "Paste your LinkedIn post link (https://www.linkedin.com/posts/… or the lnkd.in link from the app).";

/** Client helper used before submitting a post link for points.
 *  - full linkedin.com post URL -> its canonical form
 *  - lnkd.in short link (phone app) -> resolved on our server to the real post URL
 *  - anything else -> error
 *  The database re-validates whatever we send, so this is for UX only. */
export async function prepareLinkedInPostUrl(raw: string): Promise<{ url: string } | { error: string }> {
  const canon = canonicalLinkedInPostUrl(raw);
  if (canon) return { url: canon };
  if (!isLnkdInShortUrl(raw)) return { error: LINKEDIN_URL_ERROR };
  try {
    const res = await fetch("/api/linkedin/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ url: raw.trim() }),
    });
    const j = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
    if (j?.url && canonicalLinkedInPostUrl(j.url)) return { url: j.url };
    return { error: j?.error || "We couldn't check this link. Try again." };
  } catch {
    return { error: "We couldn't check this link. Try again." };
  }
}
