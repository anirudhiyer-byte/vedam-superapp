/**
 * Communication Manager Slice 3b · static list import + live count routes: integration + break-it.
 * Supabase is faked (user client for comm_* functions, service-role client only for the limiter). Fake data only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), rateHit: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: m.getUser }, rpc: m.rpc }) }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: (_u: string, key: string) =>
    key === "service-key" ? { rpc: (fn: string, args: unknown) => m.rateHit(fn, args) } : { auth: { getUser: m.getUser }, rpc: m.rpc },
}));

import { POST as importPOST } from "./lists/import/route";
import { GET as countGET } from "./lists/[id]/count/route";
import { POST as createPOST } from "./lists/route";

const ID = "7b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });
const ORIGIN = "https://staging.example";
const ROWS = [{ p: "+91 90000 00301" }, { e: "zz-3b@example.invalid" }, { p: "12345", e: "nope" }, {}];

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
const imp = (body: unknown, headers?: Record<string, string>) => importPOST(req("lists/import", { method: "POST", body, headers }));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://staging-project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  m.getUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
  m.rateHit.mockResolvedValue({ data: true, error: null });
  m.rpc.mockResolvedValue({ data: { rows: 4, matched: 2, members: 2 }, error: null });
});

describe("full flow (admin, cookie session)", () => {
  it("preview: dryRun true → comm_list_import with no name, the rows as sent", async () => {
    const res = await imp({ dryRun: true, rows: ROWS });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(m.rpc).toHaveBeenCalledWith("comm_list_import", { p_name: null, p_identifiers: ROWS, p_dry_run: true });
  });
  it("save: dryRun false → trimmed name", async () => {
    await imp({ dryRun: false, name: "  ZZ fair  ", rows: ROWS });
    expect(m.rpc).toHaveBeenCalledWith("comm_list_import", { p_name: "ZZ fair", p_identifiers: ROWS, p_dry_run: false });
  });
  it("count: GET → comm_list_count", async () => {
    m.rpc.mockResolvedValue({ data: { kind: "static", total: 2 }, error: null });
    const res = await countGET(req(`lists/${ID}/count`), ctx());
    expect(res.status).toBe(200);
    expect(m.rpc).toHaveBeenCalledWith("comm_list_count", { p_id: ID });
  });
  it("5000 rows (about 300 KB) are accepted", async () => {
    const rows = Array.from({ length: 5000 }, (_, i) => ({ p: `+91 9${String(i).padStart(9, "0")}`, e: `zz-${i}@example.invalid` }));
    expect((await imp({ dryRun: true, rows })).status).toBe(200);
  });
  it("own tight limits: comm_import 6/min per user, 20/min per IP", async () => {
    await imp({ dryRun: true, rows: ROWS });
    const keys = m.rateHit.mock.calls.map((c) => c[1] as { p_key: string; p_max: number });
    expect(keys).toContainEqual(expect.objectContaining({ p_key: "comm_import:user:admin-1", p_max: 6 }));
    expect(keys).toContainEqual(expect.objectContaining({ p_key: "comm_import:ip:203.0.113.7", p_max: 20 }));
  });
  it("the other write routes keep their 8 KB limit", async () => {
    const big = { name: "A", conditions: {}, pad: "p".repeat(9000) };
    expect((await createPOST(req("lists", { method: "POST", body: big }))).status).toBe(400);
  });
});

describe("failure paths", () => {
  it("database refuses (22023: no match / bad rows / cap) → 400; unknown or deleted list on count → 404", async () => {
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "22023", message: "no_matches" } });
    expect((await imp({ dryRun: false, name: "ZZ", rows: ROWS })).status).toBe(400);
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "P0002", message: "not_found" } });
    expect((await countGET(req(`lists/${ID}/count`), ctx())).status).toBe(404);
  });
  it("other errors → 500 without the DB message", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "secret_table broke" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await imp({ dryRun: true, rows: ROWS });
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("secret_table");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("secret_table");
    spy.mockRestore();
  });
});

describe("break-it", () => {
  it("no token → 401, nothing reaches the database", async () => {
    m.getUser.mockResolvedValue({ data: { user: null }, error: { message: "no session" } });
    expect((await imp({ dryRun: true, rows: ROWS })).status).toBe(401);
    expect((await countGET(req(`lists/${ID}/count`), ctx())).status).toBe(401);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("non-admin → 403 (database answers 42501)", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "forbidden" } });
    expect((await imp({ dryRun: true, rows: ROWS })).status).toBe(403);
    expect((await countGET(req(`lists/${ID}/count`), ctx())).status).toBe(403);
  });
  it("CSRF: cookie POST without Origin, with a foreign Origin, Origin 'null', or Sec-Fetch-Site cross-site → 403", async () => {
    for (const origin of [undefined, "https://evil.example", "null"]) {
      const headers: Record<string, string> = { host: "staging.example", "x-vercel-forwarded-for": "203.0.113.7", "content-type": "application/json" };
      if (origin) headers.origin = origin;
      const r = new Request(`${ORIGIN}/api/admin/comm/lists/import`, { method: "POST", body: JSON.stringify({ dryRun: true, rows: ROWS }), headers });
      expect((await importPOST(r)).status, String(origin)).toBe(403);
    }
    expect((await imp({ dryRun: true, rows: ROWS }, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect(m.getUser).not.toHaveBeenCalled();
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("too big: over 600 KB (by Content-Length or by actual size) → 400 before parsing; 5001 rows → 400", async () => {
    const huge = { dryRun: true, rows: Array.from({ length: 5000 }, () => ({ e: "z".repeat(150) + "@example.invalid" })) };
    expect(JSON.stringify(huge).length).toBeGreaterThan(600 * 1024);
    expect((await imp(huge)).status).toBe(400);
    expect((await imp({ dryRun: true, rows: ROWS }, { "content-length": String(700 * 1024) })).status).toBe(400);
    expect((await imp({ dryRun: true, rows: Array.from({ length: 5001 }, () => ({ p: "9000000301" })) })).status).toBe(400);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("unknown keys, other columns, wrong types → 400 (only p / e per row, nothing else)", async () => {
    const bodies = [
      { dryRun: true, rows: ROWS, owner_id: "x" }, { dryRun: true, rows: [{ p: "9000000301", name: "Zz" }] }, { dryRun: true, rows: [{ p: 9000000301 }] },
      { dryRun: true, rows: ["9000000301"] }, { dryRun: true, rows: [] }, { dryRun: "yes", rows: ROWS }, { rows: ROWS },
      { dryRun: true, rows: [{ p: "9".repeat(65) }] }, { dryRun: true, rows: [{ e: `${"a".repeat(250)}@x.in` }] },
      { dryRun: false, rows: ROWS }, { dryRun: false, name: "   ", rows: ROWS }, { dryRun: false, name: "n".repeat(81), rows: ROWS },
      { dryRun: false, name: "bad\nname", rows: ROWS },
    ];
    for (const b of bodies) expect((await imp(b)).status, JSON.stringify(b).slice(0, 80)).toBe(400);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("broken bodies → 400 / 415", async () => {
    expect((await imp("{not json")).status).toBe(400);
    expect((await imp("[1,2]")).status).toBe(400);
    const r = new Request(`${ORIGIN}/api/admin/comm/lists/import`, { method: "POST", body: JSON.stringify({ dryRun: true, rows: ROWS }),
      headers: { host: "staging.example", origin: ORIGIN, "x-vercel-forwarded-for": "203.0.113.7", "content-type": "text/csv" } });
    expect((await importPOST(r)).status).toBe(415);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("changed / malformed ids on count → 400; unknown query keys → 400", async () => {
    for (const id of ["1", "../import", `${ID}' or '1'='1`]) expect((await countGET(req(`lists/x/count`), ctx(id))).status, id).toBe(400);
    expect((await countGET(req(`lists/${ID}/count?all=1`), ctx())).status).toBe(400);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("rapid repeat: limiter says no → 429, database not called", async () => {
    let n = 0;
    m.rateHit.mockImplementation(async (_f: string, a: { p_key: string }) => ({ data: a.p_key.startsWith("comm_import:user:") ? ++n <= 2 : true, error: null }));
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await imp({ dryRun: true, rows: ROWS })).status);
    expect(codes).toEqual([200, 200, 429, 429]);
    expect(m.rpc).toHaveBeenCalledTimes(2);
  });
  it("limiter down → 503 (fails closed)", async () => {
    m.rateHit.mockResolvedValue({ data: null, error: { message: "down" } });
    expect((await imp({ dryRun: true, rows: ROWS })).status).toBe(503);
    expect(m.rpc).not.toHaveBeenCalled();
  });
});
