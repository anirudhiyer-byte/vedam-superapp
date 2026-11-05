/**
 * Communication Manager Slice 2 · Suppressions Add / Remove routes: integration + break-it.
 * Supabase is faked (user client for comm_* functions, service-role client only for the limiter). Fake data only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), rateHit: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: m.getUser }, rpc: m.rpc }) }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: (_u: string, key: string) =>
    key === "service-key" ? { rpc: (fn: string, args: unknown) => m.rateHit(fn, args) } : { auth: { getUser: m.getUser }, rpc: m.rpc },
}));

import { POST as addPOST } from "./suppressions/manual/route";
import { DELETE as removeDELETE } from "./suppressions/manual/[id]/route";
import { GET as listGET } from "./suppressions/route";

const ID = "6a2f0c8e-1b3d-4e5f-8a9b-0c1d2e3f4a5b";
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });
const ORIGIN = "https://staging.example";
const ADD = { channel: "Email", contact: "zz-s2@example.invalid", category: "Block" };
const REASON = { reason: "ZZ test: added by mistake" };

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
const add = (body: unknown = ADD) => addPOST(req("suppressions/manual", { method: "POST", body }));
const remove = (body: unknown = REASON, id = ID) => removeDELETE(req(`suppressions/manual/${id}`, { method: "DELETE", body }), ctx(id));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://staging-project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  m.getUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
  m.rateHit.mockResolvedValue({ data: true, error: null });
  m.rpc.mockResolvedValue({ data: { id: ID, status: "added" }, error: null });
});

describe("full flow (admin, cookie session)", () => {
  it("add e-mail: POST → comm_suppression_add with the fields as typed (the DB cleans them); empty note → null", async () => {
    const res = await add({ ...ADD, note: "   " });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.json()).toEqual({ ok: true, data: { id: ID, status: "added" } });
    expect(m.rpc).toHaveBeenCalledWith("comm_suppression_add", { p_channel: "Email", p_contact: "zz-s2@example.invalid", p_category: "Block", p_note: null });
  });
  it("add WhatsApp with a spaced +91 number and a note (trimmed)", async () => {
    await add({ channel: "WhatsApp", contact: "+91 90000 00301", category: "Unsubscribe", note: "  ZZ asked on call  " });
    expect(m.rpc).toHaveBeenCalledWith("comm_suppression_add", { p_channel: "WhatsApp", p_contact: "+91 90000 00301", p_category: "Unsubscribe", p_note: "ZZ asked on call" });
  });
  it("already on the list: passed through as status 'already' (200)", async () => {
    m.rpc.mockResolvedValue({ data: { id: ID, status: "already" }, error: null });
    const res = await add();
    expect(res.status).toBe(200);
    expect((await res.json()).data.status).toBe("already");
  });
  it("remove: DELETE → comm_suppression_remove with the trimmed reason", async () => {
    m.rpc.mockResolvedValue({ data: { id: ID, removed: true }, error: null });
    const res = await remove({ reason: "  ZZ test: added by mistake  " });
    expect(res.status).toBe(200);
    expect(m.rpc).toHaveBeenCalledWith("comm_suppression_remove", { p_id: ID, p_reason: "ZZ test: added by mistake" });
  });
  it("own tight limits: comm_suppress 10/min per user, 30/min per IP", async () => {
    await add();
    await remove();
    const keys = m.rateHit.mock.calls.map((c) => c[1] as { p_key: string; p_max: number });
    expect(keys).toContainEqual(expect.objectContaining({ p_key: "comm_suppress:user:admin-1", p_max: 10 }));
    expect(keys).toContainEqual(expect.objectContaining({ p_key: "comm_suppress:ip:203.0.113.7", p_max: 30 }));
  });
  it("Bearer token (API client) does not need an Origin", async () => {
    const r = new Request(`${ORIGIN}/api/admin/comm/suppressions/manual`, { method: "POST", body: JSON.stringify(ADD),
      headers: { host: "staging.example", "x-vercel-forwarded-for": "203.0.113.7", "content-type": "application/json", authorization: "Bearer t" } });
    expect((await addPOST(r)).status).toBe(200);
  });
  it("the existing list GET is unchanged (same function, same arguments)", async () => {
    m.rpc.mockResolvedValue({ data: { total: 0, rows: [] }, error: null });
    const res = await listGET(req("suppressions?channel=Email&reason=Block&page=1&size=10"));
    expect(res.status).toBe(200);
    expect(m.rpc.mock.calls[0][0]).toBe("comm_suppressions_list");
  });
});

describe("failure paths", () => {
  it("locked row (STOP / unsubscribe link / bounce): DB 55000 → 409 LOCKED", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: "55000", message: "locked" } });
    const res = await remove();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, code: "LOCKED" });
  });
  it("unknown or already removed id → 404; DB refuses the input → 400", async () => {
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "P0002", message: "not_found" } });
    expect((await remove()).status).toBe(404);
    m.rpc.mockResolvedValueOnce({ data: null, error: { code: "22023", message: "contact_invalid" } });
    expect((await add()).status).toBe(400);
  });
  it("any other DB error → 500 without the DB message (response and logs)", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "secret_table broke" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await add();
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("secret_table");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("secret_table");
    spy.mockRestore();
  });
});

describe("break-it", () => {
  it("no token → 401, nothing reaches the database", async () => {
    m.getUser.mockResolvedValue({ data: { user: null }, error: { message: "no session" } });
    expect((await add()).status).toBe(401);
    expect((await remove()).status).toBe(401);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("non-admin → 403 (database answers 42501)", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "forbidden" } });
    expect((await add()).status).toBe(403);
    expect((await remove()).status).toBe(403);
  });
  it("CSRF: cookie write without Origin, with a foreign Origin, Origin 'null', or Sec-Fetch-Site cross-site → 403", async () => {
    for (const origin of [undefined, "https://evil.example", "null"]) {
      const headers: Record<string, string> = { host: "staging.example", "x-vercel-forwarded-for": "203.0.113.7", "content-type": "application/json" };
      if (origin) headers.origin = origin;
      const a = new Request(`${ORIGIN}/api/admin/comm/suppressions/manual`, { method: "POST", body: JSON.stringify(ADD), headers });
      expect((await addPOST(a)).status, String(origin)).toBe(403);
      const d = new Request(`${ORIGIN}/api/admin/comm/suppressions/manual/${ID}`, { method: "DELETE", body: JSON.stringify(REASON), headers });
      expect((await removeDELETE(d, ctx())).status, String(origin)).toBe(403);
    }
    expect((await addPOST(req("suppressions/manual", { method: "POST", body: ADD, headers: { "sec-fetch-site": "cross-site" } }))).status).toBe(403);
    expect(m.getUser).not.toHaveBeenCalled();
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("invalid e-mails and numbers → 400 before the database", async () => {
    const bodies = [
      { ...ADD, contact: "zz-no-at.example.invalid" }, { ...ADD, contact: "zz two@example.invalid" }, { ...ADD, contact: "zz@two@example.invalid" },
      { ...ADD, contact: "zz-a@example.invalid,zz-b@example.invalid" }, { ...ADD, contact: "zz-a@example" }, { ...ADD, contact: "" },
      { ...ADD, contact: `${"a".repeat(250)}@x.in` }, { ...ADD, contact: "zz\t@example.invalid" },
      { channel: "WhatsApp", contact: "12345", category: "Unsubscribe" }, { channel: "WhatsApp", contact: "+1 202 555 0100", category: "Unsubscribe" },
      { channel: "WhatsApp", contact: "98abc76543", category: "Unsubscribe" }, { channel: "WhatsApp", contact: "5000000301", category: "Unsubscribe" },
      { channel: "WhatsApp", contact: "zz-s2@example.invalid", category: "Unsubscribe" },
    ];
    for (const b of bodies) expect((await add(b)).status, JSON.stringify(b)).toBe(400);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("bad channel / category, WhatsApp with a non-opt-out category → 400", async () => {
    const bodies = [
      { ...ADD, channel: "all" }, { ...ADD, channel: "SMS" }, { ...ADD, channel: "email" }, { ...ADD, category: "Other" }, { ...ADD, category: "block" },
      { channel: "WhatsApp", contact: "9000000302", category: "Spam" }, { channel: "WhatsApp", contact: "9000000302", category: "Block" },
    ];
    for (const b of bodies) expect((await add(b)).status, JSON.stringify(b)).toBe(400);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("no bulk: arrays, extra keys or a list of contacts → 400", async () => {
    const bodies = [
      { ...ADD, contact: ["zz-a@example.invalid", "zz-b@example.invalid"] }, { ...ADD, contacts: ["zz-a@example.invalid"] },
      [ADD, ADD], { ...ADD, user_id: "x" }, { ...ADD, reason: "manual" }, { ...ADD, added_by: "someone-else" },
    ];
    for (const b of bodies) expect((await add(b)).status, JSON.stringify(b)).toBe(400);
    expect((await remove({ reason: REASON.reason, ids: [ID, ID] })).status).toBe(400);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("huge note (201+), note with control characters, huge body (> 8 KB) → 400", async () => {
    expect((await add({ ...ADD, note: "n".repeat(201) })).status).toBe(400);
    expect((await add({ ...ADD, note: "line one\nline two" })).status).toBe(400);
    expect((await add({ ...ADD, note: "n".repeat(9000) })).status).toBe(400);
    expect((await add({ ...ADD, note: "n".repeat(200) })).status).toBe(200);   // exactly 200 is fine
    expect(m.rpc).toHaveBeenCalledTimes(1);
  });
  it("remove without a reason, with a short / blank / too long reason, or a reason with a newline → 400", async () => {
    for (const b of [{}, { reason: "" }, { reason: "too short" }, { reason: "         x" }, { reason: "r".repeat(201) }, { reason: "ZZ reason with\nnewline" }, { reason: 12345678901 }]) {
      expect((await remove(b)).status, JSON.stringify(b)).toBe(400);
    }
    const r = new Request(`${ORIGIN}/api/admin/comm/suppressions/manual/${ID}`, { method: "DELETE",
      headers: { host: "staging.example", origin: ORIGIN, "x-vercel-forwarded-for": "203.0.113.7" } });
    expect((await removeDELETE(r, ctx())).status).toBe(415);   // no body at all
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("changed / malformed ids → 400", async () => {
    for (const id of ["1", "../counts", `${ID}' or '1'='1`, "00000000-0000-0000-0000-00000000000g"]) {
      expect((await remove(REASON, id)).status, id).toBe(400);
    }
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("broken bodies → 400 / 415 (not JSON, not an object, wrong content type)", async () => {
    expect((await add("{not json")).status).toBe(400);
    expect((await add("[1,2]")).status).toBe(400);
    const r = new Request(`${ORIGIN}/api/admin/comm/suppressions/manual`, { method: "POST", body: JSON.stringify(ADD),
      headers: { host: "staging.example", origin: ORIGIN, "x-vercel-forwarded-for": "203.0.113.7", "content-type": "text/plain" } });
    expect((await addPOST(r)).status).toBe(415);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("rapid repeat: limiter says no → 429, database not called", async () => {
    let n = 0;
    m.rateHit.mockImplementation(async (_f: string, a: { p_key: string }) => ({ data: a.p_key.startsWith("comm_suppress:user:") ? ++n <= 3 : true, error: null }));
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await add()).status);
    expect(codes).toEqual([200, 200, 200, 429, 429]);
    expect(m.rpc).toHaveBeenCalledTimes(3);
  });
  it("limiter down → 503 (fails closed)", async () => {
    m.rateHit.mockResolvedValue({ data: null, error: { message: "down" } });
    expect((await add()).status).toBe(503);
    expect(m.rpc).not.toHaveBeenCalled();
  });
});
