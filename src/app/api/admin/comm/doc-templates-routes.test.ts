/**
 * Communication Manager Slice 4 · document template routes: integration + break-it.
 * Supabase is faked (user client for comm_* functions, service-role client only for the limiter). Fake data only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), rateHit: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: m.getUser }, rpc: m.rpc }) }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: (_u: string, key: string) =>
    key === "service-key" ? { rpc: (fn: string, args: unknown) => m.rateHit(fn, args) } : { auth: { getUser: m.getUser }, rpc: m.rpc },
}));

import { GET as listGET, POST as createPOST } from "./doc-templates/route";
import { POST as checkPOST } from "./doc-templates/check/route";
import { DELETE as oneDELETE, GET as oneGET, PATCH as onePATCH } from "./doc-templates/[id]/route";

const ID = "7b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });
const ORIGIN = "https://staging.example";
const GOOD = "<p>Dear {{full_name}}</p>";

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
const create = (body: unknown, headers?: Record<string, string>) => createPOST(req("doc-templates", { method: "POST", body, headers }));
const check = (body: unknown, headers?: Record<string, string>) => checkPOST(req("doc-templates/check", { method: "POST", body, headers }));
const patch = (body: unknown, id = ID) => onePATCH(req(`doc-templates/${id}`, { method: "PATCH", body }), ctx(id));
const json = async (r: Response) => (await r.json()) as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://staging-project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  m.getUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
  m.rateHit.mockResolvedValue({ data: true, error: null });
  m.rpc.mockResolvedValue({ data: { id: ID, name: "ZZ", merge_fields: ["full_name"], size: 25 }, error: null });
});

describe("full flow (admin, cookie session)", () => {
  it("list: GET → comm_doc_template_list with search / page / size", async () => {
    const res = await listGET(req("doc-templates?search=ZZ&page=2&size=5"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(m.rpc).toHaveBeenCalledWith("comm_doc_template_list", { p_search: "ZZ", p_page: 2, p_size: 5 });
  });
  it("create: the database receives the SERVER-cleaned HTML, never the browser's", async () => {
    const res = await create({ name: "  ZZ offer  ", html: "<p onclick=\"x()\">Dear {{full_name}}</p><script>alert(1)</script>" });
    expect(res.status).toBe(200);
    expect(m.rpc).toHaveBeenCalledWith("comm_doc_template_create", { p_name: "ZZ offer", p_html: "<p>Dear {{full_name}}</p>", p_dry_run: false });
    const body = await json(res);
    expect((body.data as { removed: { tags: number; handlers: number } }).removed).toMatchObject({ tags: 1, handlers: 1 });
  });
  it("check: dry run in the database, answer = cleaned HTML + removed counts + database result", async () => {
    m.rpc.mockResolvedValue({ data: { dry_run: true, merge_fields: ["full_name"], size: 25 }, error: null });
    const res = await check({ html: "<p>Dear {{full_name}}</p><img src=x onerror=alert(1)>" });
    expect(res.status).toBe(200);
    expect(m.rpc).toHaveBeenCalledWith("comm_doc_template_create", { p_name: "Preview", p_html: "<p>Dear {{full_name}}</p>", p_dry_run: true });
    const data = (await json(res)).data as Record<string, unknown>;
    expect(data).toMatchObject({ dry_run: true, merge_fields: ["full_name"], html: "<p>Dear {{full_name}}</p>" });
    expect(data.removed).toMatchObject({ tags: 1, handlers: 1 });
  });
  it("check with a name passes the trimmed name to the dry run", async () => {
    await check({ name: " ZZ x ", html: GOOD });
    expect(m.rpc).toHaveBeenCalledWith("comm_doc_template_create", expect.objectContaining({ p_name: "ZZ x", p_dry_run: true }));
  });
  it("get: GET /[id] → comm_doc_template_get", async () => {
    expect((await oneGET(req(`doc-templates/${ID}`), ctx())).status).toBe(200);
    expect(m.rpc).toHaveBeenCalledWith("comm_doc_template_get", { p_id: ID });
  });
  it("update name only: HTML stays null (kept by the database)", async () => {
    await patch({ name: " ZZ v2 " });
    expect(m.rpc).toHaveBeenCalledWith("comm_doc_template_update", { p_id: ID, p_name: "ZZ v2", p_html: null });
  });
  it("update HTML: cleaned on the server again", async () => {
    await patch({ html: "<p style=\"color:red;text-align:center\">Hi {{first_name}}</p><iframe src=x></iframe>" });
    expect(m.rpc).toHaveBeenCalledWith("comm_doc_template_update", { p_id: ID, p_name: null, p_html: "<p style=\"text-align:center\">Hi {{first_name}}</p>" });
  });
  it("delete: DELETE /[id] → comm_doc_template_delete, no body needed", async () => {
    const r = new Request(`${ORIGIN}/api/admin/comm/doc-templates/${ID}`, { method: "DELETE", headers: { host: "staging.example", origin: ORIGIN, "x-vercel-forwarded-for": "203.0.113.7" } });
    expect((await oneDELETE(r, ctx())).status).toBe(200);
    expect(m.rpc).toHaveBeenCalledWith("comm_doc_template_delete", { p_id: ID });
  });
  it("own limits: comm_doctpl 20/min per user, 60/min per IP", async () => {
    await create({ name: "ZZ", html: GOOD });
    const keys = m.rateHit.mock.calls.map((c) => c[1] as { p_key: string; p_max: number });
    expect(keys).toContainEqual(expect.objectContaining({ p_key: "comm_doctpl:user:admin-1", p_max: 20 }));
    expect(keys).toContainEqual(expect.objectContaining({ p_key: "comm_doctpl:ip:203.0.113.7", p_max: 60 }));
  });
  it("Bearer token requests work without Origin (API clients)", async () => {
    const r = new Request(`${ORIGIN}/api/admin/comm/doc-templates`, { method: "POST", body: JSON.stringify({ name: "ZZ", html: GOOD }),
      headers: { host: "staging.example", authorization: "Bearer test-token", "content-type": "application/json", "x-vercel-forwarded-for": "203.0.113.7" } });
    expect((await createPOST(r)).status).toBe(200);
  });
});

describe("refusals with a reason code (never the user's text)", () => {
  it.each([
    ["unknown merge field", "<p>{{email}}</p>", "unknown_merge_field"],
    ["{{constructor}}", "<p>{{constructor}}</p>", "unknown_merge_field"],
    ["nothing left after cleaning", "<script>alert(1)</script>", "empty"],
    ["javascript: as text", "<p>javascript:alert(1)</p>", "unsafe_text"],
    ["over 100 KB in bytes (multi-byte)", "<p>" + "é".repeat(60000) + "</p>", "too_big"],
  ])("%s → 400 %s, database not called", async (_n, html, reason) => {
    for (const res of [await create({ name: "ZZ", html }), await check({ html }), await patch({ html })]) {
      expect(res.status).toBe(400);
      expect(await json(res)).toEqual({ ok: false, code: "INVALID", reason });
    }
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("the reason never echoes what was typed", async () => {
    const res = await create({ name: "ZZ", html: "<p>{{evil_ZZMARKER}}</p>" });
    expect(await res.text()).not.toContain("ZZMARKER");
  });
});

describe("database answers", () => {
  it("22023 (second line of defence / cap) → 400; P0002 → 404 on get, update and delete; 42501 → 403", async () => {
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "22023", message: "html_unsafe" } });
    expect((await create({ name: "ZZ", html: GOOD })).status).toBe(400);
    for (const call of [() => oneGET(req(`doc-templates/${ID}`), ctx()), () => patch({ name: "ZZ" }),
      () => oneDELETE(req(`doc-templates/${ID}`, { method: "DELETE" }), ctx())]) {
      m.rpc.mockResolvedValueOnce({ data: null, error: { code: "P0002", message: "not_found" } });
      expect((await call()).status).toBe(404);
    }
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "forbidden" } });
    expect((await check({ html: GOOD })).status).toBe(403);
  });
  it("other errors → 500 without the database message, not logged either", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "secret_table broke" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await create({ name: "ZZ", html: GOOD });
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("secret_table");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("secret_table");
    spy.mockRestore();
  });
});

describe("break-it", () => {
  it("no token → 401 on every route, nothing reaches the database", async () => {
    m.getUser.mockResolvedValue({ data: { user: null }, error: { message: "no session" } });
    expect((await listGET(req("doc-templates"))).status).toBe(401);
    expect((await oneGET(req(`doc-templates/${ID}`), ctx())).status).toBe(401);
    expect((await create({ name: "ZZ", html: GOOD })).status).toBe(401);
    expect((await check({ html: GOOD })).status).toBe(401);
    expect((await patch({ name: "ZZ" })).status).toBe(401);
    expect((await oneDELETE(req(`doc-templates/${ID}`, { method: "DELETE" }), ctx())).status).toBe(401);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("non-admin → 403 (the database answers 42501)", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "forbidden" } });
    expect((await listGET(req("doc-templates"))).status).toBe(403);
    expect((await create({ name: "ZZ", html: GOOD })).status).toBe(403);
    expect((await check({ html: GOOD })).status).toBe(403);
    expect((await patch({ html: GOOD })).status).toBe(403);
  });
  it("CSRF: cookie POST / PATCH / DELETE without Origin, with a foreign Origin, Origin 'null', or Sec-Fetch-Site cross-site → 403", async () => {
    for (const origin of [undefined, "https://evil.example", "null"]) {
      const headers: Record<string, string> = { host: "staging.example", "x-vercel-forwarded-for": "203.0.113.7", "content-type": "application/json" };
      if (origin) headers.origin = origin;
      const body = JSON.stringify({ name: "ZZ", html: GOOD });
      expect((await createPOST(new Request(`${ORIGIN}/api/admin/comm/doc-templates`, { method: "POST", body, headers }))).status, String(origin)).toBe(403);
      expect((await checkPOST(new Request(`${ORIGIN}/api/admin/comm/doc-templates/check`, { method: "POST", body, headers }))).status).toBe(403);
      expect((await onePATCH(new Request(`${ORIGIN}/api/admin/comm/doc-templates/${ID}`, { method: "PATCH", body, headers }), ctx())).status).toBe(403);
      expect((await oneDELETE(new Request(`${ORIGIN}/api/admin/comm/doc-templates/${ID}`, { method: "DELETE", headers }), ctx())).status).toBe(403);
    }
    expect((await create({ name: "ZZ", html: GOOD }, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect(m.getUser).not.toHaveBeenCalled();
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("too big: over 256 KB (by Content-Length or by actual size) or over 100 KB of characters → 400 before the database", async () => {
    const huge = { name: "ZZ", html: "\"".repeat(102400) };   // 100 K quotes ≈ 200 KB as JSON, fine; 140 K is not
    expect((await create({ ...huge, html: "\"".repeat(140000) })).status).toBe(400);
    expect((await create({ name: "ZZ", html: GOOD }, { "content-length": String(300 * 1024) })).status).toBe(400);
    expect((await create({ name: "ZZ", html: "a".repeat(102401) })).status).toBe(400);
    expect(JSON.stringify(huge).length).toBeLessThan(256 * 1024);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("unknown keys, wrong types, bad names → 400 (only name / html accepted)", async () => {
    const bodies = [
      { name: "ZZ", html: GOOD, owner_id: "x" }, { name: "ZZ", html: GOOD, merge_fields: ["email"] }, { name: "ZZ", html: GOOD, id: ID },
      { name: "ZZ", html: GOOD, sanitized: true }, { name: "ZZ", html: 5 }, { name: 5, html: GOOD }, { name: "ZZ" }, { html: GOOD },
      { name: "", html: GOOD }, { name: "   ", html: GOOD }, { name: "n".repeat(81), html: GOOD }, { name: "bad\nname", html: GOOD },
      { name: "ZZ", html: "" }, { name: "ZZ", html: [GOOD] },
    ];
    for (const b of bodies) expect((await create(b)).status, JSON.stringify(b).slice(0, 80)).toBe(400);
    for (const b of [{}, { id: ID }, { name: "ZZ", owner_id: "x" }, { html: 5 }]) expect((await patch(b)).status, JSON.stringify(b)).toBe(400);
    for (const b of [{ html: GOOD, dryRun: false }, { html: GOOD, p_dry_run: false }, {}]) expect((await check(b)).status, JSON.stringify(b)).toBe(400);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("broken bodies → 400 / 415", async () => {
    expect((await create("{not json")).status).toBe(400);
    expect((await create("[1,2]")).status).toBe(400);
    const r = new Request(`${ORIGIN}/api/admin/comm/doc-templates`, { method: "POST", body: JSON.stringify({ name: "ZZ", html: GOOD }),
      headers: { host: "staging.example", origin: ORIGIN, "x-vercel-forwarded-for": "203.0.113.7", "content-type": "text/html" } });
    expect((await createPOST(r)).status).toBe(415);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("changed / malformed ids → 400; unknown query keys → 400", async () => {
    for (const id of ["1", "../check", `${ID}' or '1'='1`, `${ID}/../x`, ""]) {
      expect((await oneGET(req("doc-templates/x"), ctx(id))).status, id).toBe(400);
      expect((await patch({ name: "ZZ" }, id)).status, id).toBe(400);
      expect((await oneDELETE(req("doc-templates/x", { method: "DELETE" }), ctx(id))).status, id).toBe(400);
    }
    expect((await listGET(req("doc-templates?all=1"))).status).toBe(400);
    expect((await listGET(req("doc-templates?size=500"))).status).toBe(400);
    expect((await oneGET(req(`doc-templates/${ID}?html=1`), ctx())).status).toBe(400);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("rapid repeat: limiter says no → 429, database not called", async () => {
    let n = 0;
    m.rateHit.mockImplementation(async (_f: string, a: { p_key: string }) => ({ data: a.p_key.startsWith("comm_doctpl:user:") ? ++n <= 2 : true, error: null }));
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await check({ html: GOOD })).status);
    expect(codes).toEqual([200, 200, 429, 429]);
    expect(m.rpc).toHaveBeenCalledTimes(2);
  });
  it("limiter down → 503 (fails closed)", async () => {
    m.rateHit.mockResolvedValue({ data: null, error: { message: "down" } });
    expect((await create({ name: "ZZ", html: GOOD })).status).toBe(503);
    expect(m.rpc).not.toHaveBeenCalled();
  });
});
