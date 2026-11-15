import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  getUser: vi.fn(),
  allowIp: vi.fn(),
  syncBooking: vi.fn(),
  logInsert: vi.fn(),
  tokenClientHeaders: [] as unknown[],
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: m.getUser }, rpc: m.rpc }) }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: (_u: string, _k: string, opts: unknown) => {
    m.tokenClientHeaders.push(opts);
    return { auth: { getUser: m.getUser }, rpc: m.rpc };
  },
}));
vi.mock("@/lib/peerpath/meet-sync", () => ({
  adminDb: () => ({ from: () => ({ insert: m.logInsert }) }),
  allowIp: (...a: unknown[]) => m.allowIp(...a),
  syncBooking: (...a: unknown[]) => m.syncBooking(...a),
  trustedIp: () => "203.0.113.7",
}));

import { POST } from "./route";

const ID = "5011eb15-74e9-4f7b-8b5d-192ff8f14aef";
const SENIOR = "11111111-2222-4333-8444-555555555555";
const GOOD = { seniorId: SENIOR, start: "2026-11-06T04:30:00Z", type: "1:1", duration: 30, question: null };

function req(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://staging.example/api/peerpath/book", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { host: "staging.example", origin: "https://staging.example", "content-type": "application/json", ...headers },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  m.tokenClientHeaders.length = 0;
  m.getUser.mockResolvedValue({ data: { user: { id: "u-1" } }, error: null });
  m.allowIp.mockResolvedValue(true);
  m.syncBooking.mockResolvedValue(undefined);
  m.logInsert.mockResolvedValue({ error: null });
  m.rpc.mockResolvedValue({ data: { ok: true, code: "OK", id: ID }, error: null });
});

describe("POST /api/peerpath/book", () => {
  it("books for the logged-in user and returns the id", async () => {
    const res = await POST(req(GOOD));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, code: "OK", id: ID });
    expect(m.rpc).toHaveBeenCalledWith("pp_book", { p: GOOD });
    expect(m.syncBooking).toHaveBeenCalledWith(expect.anything(), ID);
  });

  it("CSRF: a cookie request from another site is refused before anything runs", async () => {
    const res = await POST(req(GOOD, { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    expect(m.getUser).not.toHaveBeenCalled();
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("CSRF: a cookie request with no Origin header is refused", async () => {
    const r = new Request("https://staging.example/api/peerpath/book", { method: "POST", body: JSON.stringify(GOOD), headers: { host: "staging.example", "content-type": "application/json" } });
    expect((await POST(r)).status).toBe(403);
  });

  it("a Bearer-token call (direct API with a copied token) works without Origin and uses that token", async () => {
    const r = new Request("https://staging.example/api/peerpath/book", { method: "POST", body: JSON.stringify(GOOD), headers: { host: "staging.example", "content-type": "application/json", authorization: "Bearer tok.en.x" } });
    const res = await POST(r);
    expect(res.status).toBe(200);
    expect(m.getUser).toHaveBeenCalledWith("tok.en.x");
    expect(JSON.stringify(m.tokenClientHeaders[0])).toContain("Bearer tok.en.x");
  });

  it("refuses non-JSON content", async () => {
    expect((await POST(req("seniorId=x", { "content-type": "application/x-www-form-urlencoded" }))).status).toBe(415);
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("refuses malformed, non-object and oversized bodies with INVALID", async () => {
    for (const b of ["{", "[]", "null", '"x"', JSON.stringify({ pad: "y".repeat(9000) })]) {
      const res = await POST(req(b));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ ok: false, code: "INVALID" });
    }
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("not logged in -> NOT_LOGGED_IN and the database is never called", async () => {
    m.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await POST(req(GOOD));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, code: "NOT_LOGGED_IN" });
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("per-IP limit -> RATE_LIMITED before login (junk tokens never reach Auth), no booking call, block logged", async () => {
    m.allowIp.mockResolvedValue(false);
    const res = await POST(req(GOOD));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ ok: false, code: "RATE_LIMITED" });
    expect(m.getUser).not.toHaveBeenCalled();
    expect(m.rpc).not.toHaveBeenCalled();
    expect(m.logInsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: null, code: "RATE_LIMITED", source: "route", ip: "203.0.113.7" }));
  });

  it("payment fields, email, phone and status sent by the browser never reach the database", async () => {
    await POST(req({ ...GOOD, email: "attacker@example.invalid", phone: "+919999999999", payment_stage_1: "payment_approved", vsat_paid_at: "2026-01-01", status: "completed", applicant_user_id: "u-2" }));
    expect(m.rpc).toHaveBeenCalledWith("pp_book", { p: GOOD });
  });

  it("passes the database's decision codes straight to the UI", async () => {
    for (const code of ["NOT_REGISTERED", "PAYMENT_PENDING", "BOOKING_CLOSED", "EMAIL_NOT_VERIFIED", "SLOT_UNAVAILABLE", "RATE_LIMITED", "LIMIT_REACHED"]) {
      m.rpc.mockResolvedValueOnce({ data: { ok: false, code }, error: null });
      const res = await POST(req(GOOD));
      expect(await res.json()).toEqual({ ok: false, code });
    }
    expect(m.syncBooking).not.toHaveBeenCalled();
  });

  it("a database error becomes SERVER with no raw error text", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { message: 'relation "pp_bookings" violates something', code: "42P01" } });
    const res = await POST(req(GOOD));
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ ok: false, code: "SERVER" });
    expect(text).not.toMatch(/relation|violates|42P01/);
  });

  it("a reschedule also syncs the old booking", async () => {
    const OLD = "99999999-8888-4777-8666-555555555555";
    await POST(req({ ...GOOD, rescheduleOf: OLD }));
    await new Promise((r) => setTimeout(r, 0));
    expect(m.syncBooking).toHaveBeenCalledWith(expect.anything(), ID);
    expect(m.syncBooking).toHaveBeenCalledWith(expect.anything(), OLD);
  });
});
