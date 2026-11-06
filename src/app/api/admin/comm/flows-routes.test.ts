/**
 * Communication Manager Slice 6 · WhatsApp Flow draft routes: integration + break-it.
 * Supabase is faked (user client for comm_* functions, service-role client only for the limiter). Fake data only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), rateHit: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: m.getUser }, rpc: m.rpc }) }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: (_u: string, key: string) =>
    key === "service-key" ? { rpc: (fn: string, args: unknown) => m.rateHit(fn, args) } : { auth: { getUser: m.getUser }, rpc: m.rpc },
}));

import * as listRoute from "./flows/route";
import * as oneRoute from "./flows/[id]/route";
import * as dupRoute from "./flows/[id]/duplicate/route";

const ID = "7b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });
const ORIGIN = "https://staging.example";
const SCREENS = [{ id: "screen_one", title: "Candidate Details", cta: "Continue", fields: [{ label: "Full name", kind: "text", placeholder: "Your name" }] }];
const BODY = { name: "  ZZ VSAT slot ", description: "Book a slot", module: "Leads", category: " Admissions ", screens: SCREENS };

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
const list = (qs = "", headers?: Record<string, string>) => listRoute.GET(req(`flows${qs}`, { headers }));
const create = (body: unknown, headers?: Record<string, string>) => listRoute.POST(req("flows", { method: "POST", body, headers }));
const getOne = (id = ID, qs = "") => oneRoute.GET(req(`flows/${id}${qs}`), ctx(id));
const del = (id = ID, headers?: Record<string, string>) => oneRoute.DELETE(req(`flows/${id}`, { method: "DELETE", headers }), ctx(id));
const dup = (id = ID, headers?: Record<string, string>) => dupRoute.POST(req(`flows/${id}/duplicate`, { method: "POST", headers }), ctx(id));
const json = async (r: Response) => (await r.json()) as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://staging-project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  m.getUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
  m.rateHit.mockResolvedValue({ data: true, error: null });
  m.rpc.mockResolvedValue({ data: { id: ID, name: "ZZ VSAT slot", status: "Draft" }, error: null });
});

describe("full flow (admin, cookie session)", () => {
  it("list: GET → comm_flow_list (no args), never cached", async () => {
    const res = await list();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(m.rpc).toHaveBeenCalledWith("comm_flow_list", {});
  });
  it("create: trimmed name / category, screens passed through, status never sent", async () => {
    const res = await create(BODY);
    expect(res.status).toBe(200);
    expect(m.rpc).toHaveBeenCalledWith("comm_flow_create", {
      p_name: "ZZ VSAT slot", p_description: "Book a slot", p_module: "Leads", p_category: "Admissions", p_screens: SCREENS,
    });
  });
  it("one flow (GET), delete (DELETE), duplicate (POST) call the right function with the id", async () => {
    expect((await getOne()).status).toBe(200);
    expect(m.rpc).toHaveBeenLastCalledWith("comm_flow_get", { p_id: ID });
    expect((await del()).status).toBe(200);
    expect(m.rpc).toHaveBeenLastCalledWith("comm_flow_delete", { p_id: ID });
    expect((await dup()).status).toBe(200);
    expect(m.rpc).toHaveBeenLastCalledWith("comm_flow_duplicate", { p_id: ID });
  });
  it("writes use their own limiter key (comm_flow), keyed by IP and user", async () => {
    await create(BODY);
    expect(m.rateHit).toHaveBeenCalledWith("pp_rate_hit", expect.objectContaining({ p_key: "comm_flow:ip:203.0.113.7" }));
    expect(m.rateHit).toHaveBeenCalledWith("pp_rate_hit", expect.objectContaining({ p_key: "comm_flow:user:admin-1" }));
  });
  it("no PATCH / PUT routes (no edit, no status change)", () => {
    for (const r of [listRoute, oneRoute, dupRoute]) expect(Object.keys(r).filter((k) => /^(PATCH|PUT)$/.test(k))).toEqual([]);
    expect(Object.keys(dupRoute).filter((k) => /^(GET|DELETE)$/.test(k))).toEqual([]);
  });
});

describe("who may call", () => {
  it("no session → 401 on every route, the database is never called", async () => {
    m.getUser.mockResolvedValue({ data: { user: null }, error: { message: "no session" } });
    for (const r of [await list(), await create(BODY), await getOne(), await del(), await dup()]) expect(r.status).toBe(401);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("logged in but not admin → 403 (the database refuses with 42501)", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "forbidden" } });
    for (const r of [await list(), await create(BODY), await getOne(), await del(), await dup()]) {
      expect(r.status).toBe(403);
      expect(await json(r)).toEqual({ ok: false, code: "FORBIDDEN" });
    }
  });
  it("cross-site requests → 403 before login (GET and writes)", async () => {
    const h = { "sec-fetch-site": "cross-site" };
    for (const r of [await list("", h), await create(BODY, h), await del(ID, h), await dup(ID, h)]) expect(r.status).toBe(403);
    expect(m.getUser).not.toHaveBeenCalled();
  });
  it("CSRF: a cookie write from another Origin, no Origin or Origin null → 403", async () => {
    for (const origin of ["https://evil.example", "null"]) {
      expect((await create(BODY, { origin })).status).toBe(403);
      expect((await del(ID, { origin })).status).toBe(403);
      expect((await dup(ID, { origin })).status).toBe(403);
    }
    const noOrigin = new Request(`${ORIGIN}/api/admin/comm/flows`, { method: "POST", body: JSON.stringify(BODY),
      headers: { host: "staging.example", "x-vercel-forwarded-for": "203.0.113.7", "content-type": "application/json" } });
    expect((await listRoute.POST(noOrigin)).status).toBe(403);
    expect(m.rpc).not.toHaveBeenCalled();
  });
});

describe("rate limits", () => {
  it("IP limit → 429 before login; limiter down → 503", async () => {
    m.rateHit.mockResolvedValue({ data: false, error: null });
    expect((await create(BODY)).status).toBe(429);
    expect((await list()).status).toBe(429);
    expect(m.getUser).not.toHaveBeenCalled();
    m.rateHit.mockResolvedValue({ data: null, error: { message: "down" } });
    expect((await create(BODY)).status).toBe(503);
  });
  it("rapid creates: once the per-user limit says no → 429, the database is not called", async () => {
    let calls = 0;
    m.rateHit.mockImplementation(async (_fn: string, a: { p_key: string }) => {
      if (a.p_key.startsWith("comm_flow:user:")) calls++;
      return { data: calls <= 2, error: null };
    });
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await create(BODY)).status);
    expect(codes).toEqual([200, 200, 429, 429]);
    expect(m.rpc).toHaveBeenCalledTimes(2);
  });
});

describe("break-it: input", () => {
  it.each([
    ["fromId smuggled in", { ...BODY, fromId: "f1" }],
    ["status smuggled in", { ...BODY, status: "Active" }],
    ["owner smuggled in", { ...BODY, owner_id: ID }],
    ["11 screens", { ...BODY, screens: Array.from({ length: 11 }, (_, i) => ({ id: `s${i}`, title: "T", cta: "Go", fields: [] })) }],
    ["wrong kind", { ...BODY, screens: [{ ...SCREENS[0], fields: [{ label: "A", kind: "file" }] }] }],
    ["extra screen key", { ...BODY, screens: [{ ...SCREENS[0], html: "<b>" }] }],
    ["<script> in a title", { ...BODY, screens: [{ ...SCREENS[0], title: "<script>alert(1)</script>" }] }],
    ["injection-looking name with <", { ...BODY, name: "x'); drop table comm_flows; --<" }],
    ["module outside the list", { ...BODY, module: "Opportunity" }],
    ["array instead of object", [BODY]],
  ])("%s → 400 INVALID before the database", async (_n, b) => {
    const res = await create(b);
    expect(res.status).toBe(400);
    expect(await json(res)).toEqual({ ok: false, code: "INVALID" });
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("body over 32 KB → 400 before parsing", async () => {
    const res = await create({ ...BODY, description: "d".repeat(40_000) });
    expect(res.status).toBe(400);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("not JSON → 415 / 400", async () => {
    expect((await listRoute.POST(new Request(`${ORIGIN}/api/admin/comm/flows`, { method: "POST", body: "name=x",
      headers: { host: "staging.example", origin: ORIGIN, "x-vercel-forwarded-for": "203.0.113.7", "content-type": "text/plain" } }))).status).toBe(415);
    expect((await create("{not json")).status).toBe(400);
  });
  it("ids: recommended ids (f1), junk, injection → 400, never sent to the database", async () => {
    for (const id of ["f1", "f2", "not-a-uuid", "1;drop table x", `${ID}x`]) {
      expect((await getOne(id)).status).toBe(400);
      expect((await del(id)).status).toBe(400);
      expect((await dup(id)).status).toBe(400);
    }
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("strict query: any query parameter on list / one → 400", async () => {
    for (const r of [await list("?page=1"), await list("?scope=mine"), await list(`?q=${"x".repeat(5000)}`), await getOne(ID, "?with=owner")]) expect(r.status).toBe(400);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("DELETE and duplicate take no body (extra JSON is ignored, never parsed into args)", async () => {
    await oneRoute.DELETE(req(`flows/${ID}`, { method: "DELETE", body: { id: "other" } }), ctx());
    expect(m.rpc).toHaveBeenLastCalledWith("comm_flow_delete", { p_id: ID });
  });
});

describe("database answers", () => {
  it("duplicate name (23505) → 409 CONFLICT", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: "23505", message: "name_taken" } });
    const res = await create(BODY);
    expect(res.status).toBe(409);
    expect(await json(res)).toEqual({ ok: false, code: "CONFLICT" });
  });
  it("deleted / unknown flow (P0002) → 404 on get, delete, duplicate", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: "P0002", message: "not_found" } });
    for (const r of [await getOne(), await del(), await dup()]) expect(r.status).toBe(404);
  });
  it("cap / bad screens (22023) → 400 INVALID", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "too_many_flows" } });
    const res = await create(BODY);
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain("too_many_flows");
  });
  it("any other database error → 500 SERVER; message never in the answer or the log", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "relation secret_table; 9000000399" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const r of [await list(), await create(BODY), await getOne(), await del(), await dup()]) {
      expect(r.status).toBe(500);
      const t = await r.text();
      expect(t).not.toContain("secret_table");
      expect(t).not.toContain("9000000399");
    }
    expect(JSON.stringify(spy.mock.calls)).not.toContain("secret_table");
    spy.mockRestore();
  });
});
