import { NextResponse } from "next/server";
import { createClient as createSupabase } from "@supabase/supabase-js";
import { createClient as createServer } from "@/lib/supabase/server";
import { resolveLnkdIn, isLnkdInShortUrl } from "@/lib/linkedin-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Best-effort per-instance limit (serverless memory). The real gate is the DB
// check on the final URL; this only stops one user hammering lnkd.in through us.
const WINDOW_MS = 60_000, MAX_PER_WINDOW = 10;
const hits = new Map<string, number[]>();
function allow(key: string) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= MAX_PER_WINDOW) { hits.set(key, arr); return false; }
  arr.push(now); hits.set(key, arr);
  if (hits.size > 5000) hits.clear();
  return true;
}

async function userId(req: Request): Promise<string | null> {
  try {
    const sb = await createServer();
    const { data } = await sb.auth.getUser();
    if (data?.user?.id) return data.user.id;
  } catch { /* fall through to bearer */ }
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const sb = createSupabase(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data } = await sb.auth.getUser(token);
  return data?.user?.id ?? null;
}

const MSG = {
  invalid: "That is not a LinkedIn short link.",
  not_a_post: "This link does not open a LinkedIn post. Paste your post link.",
  unavailable: "We couldn't open this short link. Open the post in your browser and paste the link from the address bar (https://www.linkedin.com/posts/…).",
} as const;

/** POST /api/linkedin/resolve { url: "https://lnkd.in/xxxx" } -> { url: canonical post URL } | { error } */
export async function POST(req: Request) {
  const uid = await userId(req);
  if (!uid) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  if (!allow(uid)) return NextResponse.json({ error: "Too many tries. Wait a minute and try again." }, { status: 429 });

  const body = await req.json().catch(() => null) as { url?: unknown } | null;
  const raw = typeof body?.url === "string" ? body.url : "";
  if (!isLnkdInShortUrl(raw)) return NextResponse.json({ error: MSG.invalid }, { status: 400 });

  const r = await resolveLnkdIn(raw);
  if (!r.ok) {
    console.warn("[linkedin/resolve]", r.reason); // no URL / user id in logs
    return NextResponse.json({ error: MSG[r.reason] }, { status: 200 });
  }
  return NextResponse.json({ url: r.url });
}
