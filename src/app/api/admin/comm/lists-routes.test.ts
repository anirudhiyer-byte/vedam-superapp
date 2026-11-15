/**
 * Communication Manager Slice 3a · Manage List routes: integration + break-it.
 * Supabase is faked (user client for comm_* functions, service-role client only for the limiter).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), rateHit: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: m.getUser }, rpc: m.rpc }) }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: (_u: string, key: string) =>
    key === "service-key" ? { rpc: (fn: string, args: unknown) => m.rateHit(fn, args) } : { auth: { getUser: m.getUser }, rpc: m.rpc },
}));

import { GET as listGET, POST as createPOST } from "./lists/route";
import { PATCH as updatePATCH, DELETE as removeDELETE } from "./lists/[id]/route";
import { POST as previewPOST } from "./lists/preview/route";
import { GET as optionsGET } from "./lists/options/route";

const ID = "5011eb15-74e9-4f7b-8b5d-192ff8f14aef";
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });
const ORIGIN = "https://staging.example";

function req(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const { method = "GET", body, headers = {} } = init;
  return new Request(`${ORIGIN}/api/admin/comm/${path}`, {
    method,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    headers: {
      host: "staging.example", "x-vercel-forwarded-for": "203.0.113.7",
      ...(method === "GET" ? {} : { origin: ORIGIN }), ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers,
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://staging-project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  m.getUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
  m.rateHit.mockResolvedValue({ data: true, error: null });
  m.rpc.mockResolvedValue({ data: { ok: true }, error: null });
});

describe("full flow (admin, cookie session)", () => {
  it("list: GET → comm_lists_list with search/page/size", async () => {
    m.rpc.mockResolvedValue({ data: { total: 0, rows: [] }, error: null });
    const res = await listGET(req("lists?search=paid&page=2&size=25"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(m.rpc).toHaveBeenCalledWith("comm_lists_list", { p_search: "paid", p_page: 2, p_size: 25 });
  });
  it("create: POST → comm_list_create with trimmed name + conditions", async () => {
    const res = await createPOST(req("lists", { method: "POST", body: { name: "  Paid  ", conditions: { payment: "paid" } } }));
    expect(res.status).toBe(200);
    expect(m.rpc).toHaveBeenCalledWith("comm_list_create", { p_name: "Paid", p_conditions: { payment: "paid" } });
  });
  it("update: PATCH → comm_list_update (missing fields sent as null = keep)", async () => {
    await updatePATCH(req(`lists/${ID}`, { method: "PATCH", body: { name: "New name" } }), ctx());
    expect(m.rpc).toHaveBeenCalledWith("comm_list_update", { p_id: ID, p_name: "New name", p_conditions: null });
  });
  it("delete: DELETE → comm_list_delete", async () => {
    await removeDELETE(req(`lists/${ID}`, { method: "DELETE" }), ctx());
    expect(m.rpc).toHaveBeenCalledWith("comm_list_delete", { p_id: ID });
  });
  it("preview + options", async () => {
    await previewPOST(req("lists/preview", { method: "POST", body: { conditions: { consent_given: true } } }));
    await optionsGET(req("lists/options"));
    expect(m.rpc.mock.calls.map((c) => c[0])).toEqual(["comm_audience_preview", "comm_list_options"]);
    expect(m.rpc.mock.calls[0][1]).toEqual({ p_conditions: { consent_given: true } });
  });
  it("writes use their own tighter limits; preview has its own bucket", async () => {
    await createPOST(req("lists", { method: "POST", body: { name: "A", conditions: {} } }));
    await previewPOST(req("lists/preview", { method: "POST", body: { conditions: {} } }));
    const keys = m.rateHit.mock.calls.map((c) => (c[1] as { p_key: string; p_max: number }));
    expect(keys).toContainEqual(expect.objectContaining({ p_key: "comm_write:user:admin-1", p_max: 20 }));
    expect(keys).toContainEqual(expect.objectContaining({ p_key: "comm_preview:user:admin-1", p_max: 30 }));
    expect(keys).toContainEqual(expect.objectContaining({ p_key: "comm_write:ip:203.0.113.7" }));
  });
  it("Bearer token (API client) does not need an Origin", async () => {
    const r = new Request(`${ORIGIN}/api/admin/comm/lists`, { method: "POST", body: JSON.stringify({ name: "A", conditions: {} }),
      headers: { host: "staging.example", "x-vercel-forwarded-for": "203.0.113.7", "content-type": "application/json", authorization: "Bearer t" } });
    expect((await createPOST(r)).status).toBe(200);
  });
});

describe("failure paths", () => {
  it("unknown / deleted list → 404", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: "P0002", message: "not_found" } });
    expect((await updatePATCH(req(`lists/${ID}`, { method: "PATCH", body: { name: "x" } }), ctx())).status).toBe(404);
    expect((await removeDELETE(req(`lists/${ID}`, { method: "DELETE" }), ctx())).status).toBe(404);
  });
  it("database refuses conditions (22023) → 400; other errors → 500 without the DB message", async () => {
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "22023", message: "conditions_invalid:state" } });
    expect((await previewPOST(req("lists/preview", { method: "POST", body: { conditions: {} } }))).status).toBe(400);
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "secret_table broke" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await createPOST(req("lists", { method: "POST", body: { name: "A", conditions: {} } }));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("secret_table");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("secret_table");
    spy.mockRestore();
  });
});

describe("break-it", () => {
  it("no token → 401, nothing reaches the database", async () => {
    m.getUser.mockResolvedValue({ data: { user: null }, error: { message: "no session" } });
    for (const r of [listGET(req("lists")), createPOST(req("lists", { method: "POST", body: { name: "A", conditions: {} } })),
      previewPOST(req("lists/preview", { method: "POST", body: { conditions: {} } })), removeDELETE(req(`lists/${ID}`, { method: "DELETE" }), ctx())]) {
      expect((await r).status).toBe(401);
    }
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("non-admin → 403 (database answers 42501)", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "forbidden" } });
    expect((await createPOST(req("lists", { method: "POST", body: { name: "A", conditions: {} } }))).status).toBe(403);
    expect((await previewPOST(req("lists/preview", { method: "POST", body: { conditions: {} } }))).status).toBe(403);
    expect((await optionsGET(req("lists/options"))).status).toBe(403);
  });
  it("CSRF: cookie write without Origin, with a foreign Origin, or Origin 'null' → 403", async () => {
    for (const origin of [undefined, "https://evil.example", "null"]) {
      const headers: Record<string, string> = { host: "staging.example", "x-vercel-forwarded-for": "203.0.113.7", "content-type": "application/json" };
      if (origin) headers.origin = origin;
      const r = new Request(`${ORIGIN}/api/admin/comm/lists`, { method: "POST", body: JSON.stringify({ name: "A", conditions: {} }), headers });
      expect((await createPOST(r)).status, String(origin)).toBe(403);
      const d = new Request(`${ORIGIN}/api/admin/comm/lists/${ID}`, { method: "DELETE", headers });
      expect((await removeDELETE(d, ctx())).status, String(origin)).toBe(403);
    }
    expect(m.getUser).not.toHaveBeenCalled();
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("changed / malformed ids → 400", async () => {
    for (const id of ["1", "../preview", `${ID}' or '1'='1`]) {
      expect((await updatePATCH(req("lists/x", { method: "PATCH", body: { name: "x" } }), ctx(id))).status, id).toBe(400);
      expect((await removeDELETE(req("lists/x", { method: "DELETE" }), ctx(id))).status, id).toBe(400);
    }
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("protected fields and unknown keys → 400", async () => {
    const bodies = [
      { name: "A", conditions: {}, owner_id: "x" }, { name: "A", conditions: {}, kind: "static" },
      { name: "A", conditions: { full_name: ["x"] } }, { name: "A", conditions: { date_of_birth: ["2010-01-01"] } },
      { name: "A", conditions: { father_mobile: ["x"] } },
    ];
    for (const b of bodies) expect((await createPOST(req("lists", { method: "POST", body: b }))).status, JSON.stringify(b)).toBe(400);
    expect((await updatePATCH(req(`lists/${ID}`, { method: "PATCH", body: { deleted_at: null } }), ctx())).status).toBe(400);
    expect((await previewPOST(req("lists/preview", { method: "POST", body: { conditions: {}, limit: 1e6 } }))).status).toBe(400);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("huge or broken bodies → 400 (over 8 KB, not JSON, not an object, wrong content type)", async () => {
    const huge = { name: "A", conditions: { utm_source: Array.from({ length: 20 }, () => "z".repeat(100)) }, pad: "p".repeat(9000) };
    expect((await createPOST(req("lists", { method: "POST", body: huge }))).status).toBe(400);
    expect((await createPOST(req("lists", { method: "POST", body: "{not json" }))).status).toBe(400);
    expect((await createPOST(req("lists", { method: "POST", body: "[1,2]" }))).status).toBe(400);
    const r = new Request(`${ORIGIN}/api/admin/comm/lists`, { method: "POST", body: JSON.stringify({ name: "A", conditions: {} }),
      headers: { host: "staging.example", origin: ORIGIN, "x-vercel-forwarded-for": "203.0.113.7", "content-type": "text/plain" } });
    expect((await createPOST(r)).status).toBe(415);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("conditions over 4096 bytes → 400 before the database", async () => {
    // 20 + 20 values of ~96 chars plus one 90-char state: just over 4096 bytes, every single value still valid
    const big = { utm_source: Array.from({ length: 20 }, (_, i) => "z".repeat(95) + i), utm_campaign: Array.from({ length: 20 }, (_, i) => "w".repeat(95) + i), state: ["x".repeat(90)] };
    expect(new TextEncoder().encode(JSON.stringify(big)).length).toBeGreaterThan(4096);
    expect((await previewPOST(req("lists/preview", { method: "POST", body: { conditions: big } }))).status).toBe(400);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("rapid repeat: limiter says no → 429, database not called", async () => {
    let n = 0;
    m.rateHit.mockImplementation(async (_f: string, a: { p_key: string }) => ({ data: a.p_key.startsWith("comm_preview:user:") ? ++n <= 2 : true, error: null }));
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await previewPOST(req("lists/preview", { method: "POST", body: { conditions: {} } }))).status);
    expect(codes).toEqual([200, 200, 429, 429]);
    expect(m.rpc).toHaveBeenCalledTimes(2);
  });
  it("limiter down → 503 (fails closed)", async () => {
    m.rateHit.mockResolvedValue({ data: null, error: { message: "down" } });
    expect((await createPOST(req("lists", { method: "POST", body: { name: "A", conditions: {} } }))).status).toBe(503);
    expect(m.rpc).not.toHaveBeenCalled();
  });
});
