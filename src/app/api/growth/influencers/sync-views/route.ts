import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sameOrigin } from "@/lib/peerpath/book-request";
import { youTubeId } from "@/lib/growth/marketing";

export const dynamic = "force-dynamic";

/**
 * POST /api/growth/influencers/sync-views — pulls the current view count of every YouTube
 * influencer post (from its live link) and saves it as the post's actual views.
 *
 * Runs as the signed-in user: growth_infl_youtube_targets / growth_infl_views_set (migration 0105)
 * check the admin role in the database, so a non-admin gets FORBIDDEN from there.
 * Instagram views stay manual (no public API for them).
 * Needs YOUTUBE_API_KEY (server-only env var, YouTube Data API v3).
 */

const BATCH = 50;          // YouTube allows up to 50 ids per videos.list call
const MAX_POSTS = 2000;    // 40 calls at most per sync

type Target = { id: string; live_link: string | null };

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Bad origin." }, { status: 403 });

  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return NextResponse.json({ error: "YouTube sync is not set up yet (YOUTUBE_API_KEY is missing on the server)." }, { status: 400 });

  const sb = await createClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Please sign in again." }, { status: 401 });

  const t = await sb.rpc("growth_infl_youtube_targets");
  if (t.error) {
    const forbidden = /FORBIDDEN|NOT_SIGNED_IN/.test(t.error.message);
    return NextResponse.json({ error: forbidden ? "Only admins can sync views." : "Could not load posts." }, { status: forbidden ? 403 : 500 });
  }
  const targets = ((t.data ?? []) as Target[]).slice(0, MAX_POSTS);

  // post id → video id; posts without a recognisable YouTube link count as missing
  const byVideo = new Map<string, string[]>();
  let missing = 0;
  for (const p of targets) {
    const vid = youTubeId(p.live_link);
    if (!vid) { missing++; continue; }
    byVideo.set(vid, [...(byVideo.get(vid) ?? []), p.id]);
  }

  const videoIds = [...byVideo.keys()];
  const items: { id: string; views: number }[] = [];
  for (let i = 0; i < videoIds.length; i += BATCH) {
    const chunk = videoIds.slice(i, i + BATCH);
    const url = `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${chunk.map(encodeURIComponent).join(",")}&key=${encodeURIComponent(key)}`;
    let body: { items?: { id: string; statistics?: { viewCount?: string } }[] };
    try {
      const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15000) });
      // YouTube's error text is never passed on (it can echo request details)
      if (!r.ok) return NextResponse.json({ error: r.status === 403 ? "YouTube refused the request (check the API key / quota)." : "YouTube did not answer. Try again." }, { status: 502 });
      body = await r.json();
    } catch {
      return NextResponse.json({ error: "YouTube did not answer. Try again." }, { status: 502 });
    }
    const found = new Set<string>();
    for (const v of body.items ?? []) {
      const n = Number(v.statistics?.viewCount);
      if (!Number.isFinite(n) || n < 0) continue;
      found.add(v.id);
      for (const postId of byVideo.get(v.id) ?? []) items.push({ id: postId, views: Math.round(n) });
    }
    for (const vid of chunk) if (!found.has(vid)) missing += byVideo.get(vid)?.length ?? 0; // private / deleted / wrong id
  }

  if (items.length) {
    const s = await sb.rpc("growth_infl_views_set", { p: { items } });
    if (s.error) return NextResponse.json({ error: "Could not save the views." }, { status: 500 });
  }
  return NextResponse.json({ updated: items.length, checked: targets.length, missing });
}
