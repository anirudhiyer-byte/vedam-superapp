import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), fetch: vi.fn(), allowIp: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: m.getUser }, rpc: m.rpc }) }));
vi.mock("@/lib/growth/api", () => ({ svc: () => ({}) }));
vi.mock("@/lib/peerpath/meet-sync", () => ({ allowIp: (...a: unknown[]) => m.allowIp(...a), trustedIp: () => "203.0.113.7" }));

import { POST } from "./route";

const KEY = "test-youtube-key-not-real";
const req = (headers: Record<string, string> = {}) =>
  new Request("https://staging.example/api/growth/influencers/sync-views", {
    method: "POST",
    headers: { host: "staging.example", origin: "https://staging.example", ...headers },
  });
const yt = (items: { id: string; views: string | number }[]) =>
  new Response(JSON.stringify({ items: items.map((i) => ({ id: i.id, statistics: { viewCount: String(i.views) } })) }), { status: 200 });
// 11-character YouTube video ids
const V1 = "aaaaaaaaaa1", V2 = "bbbbbbbbbb2";

let targets: { id: string; live_link: string | null }[];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("YOUTUBE_API_KEY", KEY);
  vi.stubGlobal("fetch", m.fetch);
  m.getUser.mockResolvedValue({ data: { user: { id: "u-admin" } }, error: null });
  m.allowIp.mockResolvedValue(true);
  targets = [
    { id: "post-1", live_link: `https://www.youtube.com/watch?v=${V1}` },
    { id: "post-2", live_link: `https://youtube.com/shorts/${V2}` },
    { id: "post-3", live_link: "https://example.com/not-youtube" },
  ];
  m.rpc.mockImplementation(async (fn: string) =>
    fn === "growth_infl_youtube_targets" ? { data: targets, error: null } : { data: { updated: 1 }, error: null });
  m.fetch.mockImplementation(async () => yt([{ id: V1, views: 245000 }]));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("POST /api/growth/influencers/sync-views", () => {
  it("reads views for each YouTube link and saves them as the signed-in user", async () => {
    const res = await POST(req());
    const body = await res.json();
    expect(res.status).toBe(200);
    // post-2's video is not returned by YouTube (private / deleted), post-3 is not a YouTube link
    expect(body).toEqual({ updated: 1, checked: 3, missing: 2 });
    expect(m.fetch).toHaveBeenCalledTimes(1);
    const url = new URL(m.fetch.mock.calls[0][0] as string);
    expect(url.origin + url.pathname).toBe("https://www.googleapis.com/youtube/v3/videos");
    expect(url.searchParams.get("part")).toBe("statistics");
    expect(url.searchParams.get("id")).toBe(`${V1},${V2}`);
    expect(m.rpc).toHaveBeenCalledWith("growth_infl_views_set", { p: { items: [{ id: "post-1", views: 245000 }] } });
  });

  it("gives the same views to two posts of the same video", async () => {
    targets = [{ id: "a", live_link: `https://youtu.be/${V1}` }, { id: "b", live_link: `https://www.youtube.com/watch?v=${V1}&t=10` }];
    const body = await (await POST(req())).json();
    expect(body).toEqual({ updated: 2, checked: 2, missing: 0 });
    expect(m.rpc).toHaveBeenCalledWith("growth_infl_views_set", { p: { items: [{ id: "a", views: 245000 }, { id: "b", views: 245000 }] } });
  });

  it("asks YouTube in batches of 50 videos", async () => {
    targets = Array.from({ length: 120 }, (_, i) => ({ id: `p${i}`, live_link: `https://youtu.be/${String(i).padStart(11, "v")}` }));
    m.fetch.mockImplementation(async () => yt([]));   // a fresh Response per call (a body can only be read once)
    const body = await (await POST(req())).json();
    expect(m.fetch).toHaveBeenCalledTimes(3);
    expect(body).toEqual({ updated: 0, checked: 120, missing: 120 });
    expect(m.rpc).not.toHaveBeenCalledWith("growth_infl_views_set", expect.anything());
  });

  it("limits syncs per IP (10 per 10 minutes) before anything else runs", async () => {
    await POST(req());
    expect(m.allowIp).toHaveBeenCalledWith(expect.anything(), "growth_yt_sync", "203.0.113.7", 10, 600);
    vi.clearAllMocks();
    m.allowIp.mockResolvedValue(false);
    const res = await POST(req());
    expect(res.status).toBe(429);
    expect(m.getUser).not.toHaveBeenCalled();
    expect(m.rpc).not.toHaveBeenCalled();
    expect(m.fetch).not.toHaveBeenCalled();
  });

  it("refuses a cross-site request before doing anything", async () => {
    expect((await POST(req({ origin: "https://evil.example" }))).status).toBe(403);
    expect(m.allowIp).not.toHaveBeenCalled();
    expect(m.rpc).not.toHaveBeenCalled();
    expect(m.fetch).not.toHaveBeenCalled();
  });

  it("refuses when not signed in", async () => {
    m.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await POST(req())).status).toBe(401);
    expect(m.fetch).not.toHaveBeenCalled();
  });

  it("a non-admin gets 403 from the database check", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { message: "FORBIDDEN" } });
    const res = await POST(req());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Only admins can sync views." });
    expect(m.fetch).not.toHaveBeenCalled();
  });

  it("says clearly when the API key is not set", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "");
    const res = await POST(req());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/YOUTUBE_API_KEY/);
    expect(m.fetch).not.toHaveBeenCalled();
  });

  it("YouTube errors are not passed on, and the key never appears in the answer", async () => {
    m.fetch.mockResolvedValue(new Response(JSON.stringify({ error: { message: `bad key ${KEY}` } }), { status: 403 }));
    const res = await POST(req());
    const text = await res.text();
    expect(res.status).toBe(502);
    expect(text).not.toContain(KEY);
    expect(JSON.parse(text).error).toMatch(/API key \/ quota/);
    expect(m.rpc).not.toHaveBeenCalledWith("growth_infl_views_set", expect.anything());
  });

  it("a network failure is a clean 502", async () => {
    m.fetch.mockRejectedValue(new Error("socket hang up"));
    const res = await POST(req());
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "YouTube did not answer. Try again." });
  });
});
