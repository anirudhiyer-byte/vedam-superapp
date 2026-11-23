/**
 * VSAT Acceptance Letter download route: integration + break-it. Supabase is faked (the user's cookie client);
 * who may see which letter is the database's job (vsat_offer_letter, tested in supabase/tests/vsat_offer_letter.test.sql).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: m.getUser }, rpc: m.rpc }) }));

import { GET } from "./route";

const req = (qs = "") => new Request(`https://staging.example/api/vsat/offer-letter${qs}`);
const letter = {
  available: true, application_id: "A1", name: "LABANA PRINCEKUMAR", campus: "pune", scholarship_pct: 20, programme_fee: "1850000",
  offer_days: 2, seat_block: "50000", released_at: "2026-11-23T10:00:00Z", expires_at: "2026-11-25T18:29:59Z", stage: "offer_sent",
};

beforeEach(() => {
  vi.clearAllMocks();
  m.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  m.rpc.mockResolvedValue({ data: letter, error: null });
});

describe("GET /api/vsat/offer-letter", () => {
  it("student: own letter as a PDF download, asked as the user with no key", async () => {
    const r = await GET(req());
    expect(r.status).toBe(200);
    expect(m.rpc).toHaveBeenCalledWith("vsat_offer_letter", { p: {} });
    expect(r.headers.get("content-type")).toBe("application/pdf");
    expect(r.headers.get("content-disposition")).toBe('attachment; filename="Acceptance_Letter_LABANA_PRINCEKUMAR.pdf"');
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    const b = Buffer.from(await r.arrayBuffer());
    expect(b.subarray(0, 5).toString()).toBe("%PDF-");
  }, 30_000);
  it("admin: passes the application id on; view=1 opens it in the browser", async () => {
    const r = await GET(req("?application_id=VSAT-26-0001&view=1"));
    expect(m.rpc).toHaveBeenCalledWith("vsat_offer_letter", { p: { application_id: "VSAT-26-0001" } });
    expect(r.headers.get("content-disposition")).toMatch(/^inline;/);
  }, 30_000);
  it("not signed in → 401, the database is never asked", async () => {
    m.getUser.mockResolvedValue({ data: { user: null } });
    const r = await GET(req());
    expect(r.status).toBe(401);
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("break-it: odd application ids are refused before the database", async () => {
    for (const bad of ["", "a b", "x'or'1'='1", "../../x", "A".repeat(81), "%00"]) {
      const r = await GET(req(`?application_id=${encodeURIComponent(bad)}`));
      expect(r.status).toBe(400);
    }
    expect(m.rpc).not.toHaveBeenCalled();
  });
  it("database says FORBIDDEN / NOT_FOUND / other error → 403 / 404 / 500, no detail leaked", async () => {
    for (const [msg, code] of [["FORBIDDEN", 403], ["NOT_FOUND", 404], ["boom: relation x", 500]] as const) {
      m.rpc.mockResolvedValueOnce({ data: null, error: { message: msg } });
      const r = await GET(req("?application_id=A1"));
      expect(r.status).toBe(code);
      expect(JSON.stringify(await r.json())).not.toMatch(/relation/);
    }
  });
  it("nothing to show (no offer / cancelled / unknown campus) → 404 with the reason", async () => {
    m.rpc.mockResolvedValueOnce({ data: { available: false, reason: "NOT_ACTIVE" }, error: null });
    let r = await GET(req());
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ ok: false, code: "NOT_ACTIVE" });
    m.rpc.mockResolvedValueOnce({ data: { ...letter, campus: "mumbai" }, error: null });
    r = await GET(req());
    expect(r.status).toBe(404);
  });
});
