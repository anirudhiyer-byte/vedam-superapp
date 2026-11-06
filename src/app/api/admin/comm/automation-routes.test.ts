/**
 * Communication Manager Slice 8 · GET /api/admin/comm/automation (Manage Automation, read-only).
 * Route integration + break-it tests. Supabase is faked: the user client (cookie or Bearer) and the
 * service-role client used only for the rate limiter. No network, no real data.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  rpc: vi.fn(),          // the user's client (comm_* functions)
  getUser: vi.fn(),
  rateHit: vi.fn(),      // service-role client: pp_rate_hit
  clients: [] as { key: string; opts: unknown }[],
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: m.getUser }, rpc: m.rpc }) }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: (_u: string, key: string, opts: unknown) => {
    m.clients.push({ key, opts });
    if (key === "service-key") return { rpc: (fn: string, args: unknown) => m.rateHit(fn, args) };
    return { auth: { getUser: m.getUser }, rpc: m.rpc };
  },
}));

import * as route from "./automation/route";

const { GET } = route;
const DATA = {
  total: 1, truncated: false,
  rows: [{ engine: "whatsapp", id: "5011eb15-74e9-4f7b-8b5d-192ff8f14aef", name: "ZZ reminder", enabled: true, channel: "whatsapp", trigger: "scheduled",
           product: null, created_at: "2026-11-01T05:00:00Z", last_run_at: null, runs: 0, last_sent: null, last_failed: null, last_status: "never" }],
};

function req(qs = "", headers: Record<string, string> = {}) {
  return new Request(`https://staging.example/api/admin/comm/automation${qs}`, {
    headers: { host: "staging.example", "x-vercel-forwarded-for": "203.0.113.7", ...headers },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  m.clients.length = 0;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://staging-project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  m.getUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
  m.rateHit.mockResolvedValue({ data: true, error: null });
  m.rpc.mockResolvedValue({ data: DATA, error: null });
});

describe("full flow (admin)", () => {
  it("calls comm_automation_list with no arguments, returns { ok, data }, never cached", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.json()).toEqual({ ok: true, data: DATA });
    expect(m.rpc).toHaveBeenCalledTimes(1);
    expect(m.rpc).toHaveBeenCalledWith("comm_automation_list", {});
  });
  it("Bearer token: uses a token client with that header (API clients)", async () => {
    const res = await GET(req("", { authorization: "Bearer test-token" }));
    expect(res.status).toBe(200);
    expect(m.getUser).toHaveBeenCalledWith("test-token");
    expect(m.clients.some((c) => JSON.stringify(c.opts).includes("Bearer test-token"))).toBe(true);
  });
  it("rate limits are keyed by trusted IP and by user, on the private limiter", async () => {
    await GET(req());
    expect(m.rateHit).toHaveBeenCalledWith("pp_rate_hit", { p_key: "comm_read:ip:203.0.113.7", p_max: 300, p_window: 60 });
    expect(m.rateHit).toHaveBeenCalledWith("pp_rate_hit", { p_key: "comm_read:user:admin-1", p_max: 120, p_window: 60 });
  });
  it("read-only: the route exports GET only (no POST / PATCH / PUT / DELETE)", () => {
    expect(Object.keys(route).filter((k) => /^(POST|PATCH|PUT|DELETE)$/.test(k))).toEqual([]);
  });
});

describe("who may call", () => {
  it("no session / no token → 401, the database function is never called", async () => {
    m.getUser.mockResolvedValue({ data: { user: null }, error: { message: "no session" } });
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, code: "NOT_LOGGED_IN" });
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("junk Bearer token → 401", async () => {
    m.getUser.mockResolvedValue({ data: { user: null }, error: { message: "bad jwt" } });
    expect((await GET(req("", { authorization: "Bearer not-a-real-token" }))).status).toBe(401);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("logged in but not admin → 403 (the database refuses with 42501)", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "forbidden" } });
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, code: "FORBIDDEN" });
  });
  it("cross-site browser request (Sec-Fetch-Site: cross-site) → 403, before login and database", async () => {
    const res = await GET(req("", { "sec-fetch-site": "cross-site" }));
    expect(res.status).toBe(403);
    expect(m.getUser).not.toHaveBeenCalled();
    expect(m.rateHit).not.toHaveBeenCalled();
    expect(m.rpc).not.toHaveBeenCalled();
  });
});

describe("rate limits", () => {
  it("IP flood: per-IP limit answers 429 before any login check", async () => {
    m.rateHit.mockResolvedValue({ data: false, error: null });
    const res = await GET(req());
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ ok: false, code: "RATE_LIMITED" });
    expect(m.getUser).not.toHaveBeenCalled();
  });
  it("rapid repeat: once the per-user limiter says no → 429, the database function is not called", async () => {
    let calls = 0;
    m.rateHit.mockImplementation(async (_fn: string, args: { p_key: string }) => {
      if (args.p_key.startsWith("comm_read:user:")) calls++;
      return { data: calls <= 3, error: null };
    });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await GET(req())).status);
    expect(codes).toEqual([200, 200, 200, 429, 429]);
    expect(m.rpc).toHaveBeenCalledTimes(3);
  });
  it("limiter unavailable → 503, nothing else runs", async () => {
    m.rateHit.mockResolvedValue({ data: null, error: { message: "down" } });
    expect((await GET(req())).status).toBe(503);
    expect(m.getUser).not.toHaveBeenCalled();
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("no trusted IP on Vercel → refused (fails closed)", async () => {
    process.env.VERCEL = "1";
    try {
      const r = new Request("https://staging.example/api/admin/comm/automation", { headers: { host: "staging.example" } });
      expect((await GET(r)).status).toBe(429);
      expect(m.rpc).not.toHaveBeenCalled();
    } finally {
      delete process.env.VERCEL;
    }
  });
});

describe("break-it: query string", () => {
  it.each([
    ["?page=1", "a param from other pages"],
    ["?size=100000", "huge page size"],
    ["?status=Active", "a filter (filters run in the browser)"],
    ["?search=x", "search"],
    ["?p_cap=100000", "a function argument"],
    ["?engine=whatsapp&engine=journey", "repeated key"],
    [`?search=${encodeURIComponent("'; drop table public.whatsapp_automations; --")}`, "injection string"],
    [`?name=${"x".repeat(10000)}`, "10,000-character value"],
    ["?created_by=admin-1", "a protected field"],
  ])("%s (%s) → 400 INVALID before the database", async (qs) => {
    const res = await GET(req(qs));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, code: "INVALID" });
    expect(m.rpc).not.toHaveBeenCalled();
  });
});

describe("no database error leaks", () => {
  it("database error → 500 SERVER; neither the answer nor the log contains the message", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "relation secret_table does not exist; phone 9000000399" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(req());
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("secret_table");
    expect(text).not.toContain("9000000399");
    expect(JSON.parse(text)).toEqual({ ok: false, code: "SERVER" });
    expect(JSON.stringify(spy.mock.calls)).not.toContain("secret_table");
    expect(JSON.stringify(spy.mock.calls)).toContain("comm_automation_list");
    spy.mockRestore();
  });
  it("a thrown 22023 from the database → 400 INVALID (no message passed on)", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "internal detail" } });
    const res = await GET(req());
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain("internal detail");
  });
});
