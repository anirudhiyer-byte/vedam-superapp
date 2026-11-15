import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), allowIp: vi.fn(), syncBooking: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: m.getUser }, rpc: m.rpc }) }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { getUser: m.getUser }, rpc: m.rpc }) }));
vi.mock("@/lib/peerpath/meet-sync", () => ({
  adminDb: () => ({}),
  allowIp: (...a: unknown[]) => m.allowIp(...a),
  syncBooking: (...a: unknown[]) => m.syncBooking(...a),
  trustedIp: () => "203.0.113.7",
}));

import { POST } from "./route";

const ID = "5011eb15-74e9-4f7b-8b5d-192ff8f14aef";
const req = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://staging.example/api/peerpath/cancel", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { host: "staging.example", origin: "https://staging.example", "content-type": "application/json", ...headers },
  });

beforeEach(() => {
  vi.clearAllMocks();
  m.getUser.mockResolvedValue({ data: { user: { id: "u-1" } }, error: null });
  m.allowIp.mockResolvedValue(true);
  m.syncBooking.mockResolvedValue(undefined);
  m.rpc.mockResolvedValue({ data: { ok: true }, error: null });
});

describe("POST /api/peerpath/cancel", () => {
  it("cancels as the logged-in user (ownership checked by pp_cancel via auth.uid())", async () => {
    const res = await POST(req({ id: ID }));
    expect(await res.json()).toEqual({ ok: true });
    expect(m.rpc).toHaveBeenCalledWith("pp_cancel", { p_id: ID });
    expect(m.syncBooking).toHaveBeenCalledWith(expect.anything(), ID);
  });
  it("refuses a cross-site cookie request", async () => {
    expect((await POST(req({ id: ID }, { origin: "https://evil.example" }))).status).toBe(403);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("refuses when not logged in", async () => {
    m.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await POST(req({ id: ID }))).status).toBe(401);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("refuses a bad id without calling the database", async () => {
    for (const id of ["x", 1, null, "' or 1=1 --"]) expect((await POST(req({ id }))).status).toBe(400);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("per-IP limit runs before the login check", async () => {
    m.allowIp.mockResolvedValue(false);
    expect(await (await POST(req({ id: ID }))).json()).toEqual({ ok: false, error: "rate_limited" });
    expect(m.getUser).not.toHaveBeenCalled();
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("someone else's booking looks like not found, and nothing is synced", async () => {
    m.rpc.mockResolvedValue({ data: { ok: false, error: "not_found" }, error: null });
    expect(await (await POST(req({ id: ID }))).json()).toEqual({ ok: false, error: "not_found" });
    expect(m.syncBooking).not.toHaveBeenCalled();
  });
  it("database errors never leak", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { message: "permission denied for function pp_cancel" } });
    const text = await (await POST(req({ id: ID }))).text();
    expect(JSON.parse(text)).toEqual({ ok: false, error: "server" });
    expect(text).not.toMatch(/permission|pp_cancel/);
  });
});
