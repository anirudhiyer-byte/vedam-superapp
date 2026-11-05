/**
 * Communication Manager Slice 1 · route integration + break-it tests.
 * Supabase is faked: the user client (cookie or Bearer) and the service-role client
 * used only for the rate limiter. No network, no real data.
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

import { GET as logsGET } from "./logs/route";
import { GET as optionsGET } from "./logs/options/route";
import { GET as oneGET } from "./logs/[id]/route";
import { GET as recipientsGET } from "./logs/[id]/recipients/route";
import { GET as failuresGET } from "./logs/[id]/failures/route";
import { GET as perfGET } from "./performance/route";
import { GET as supGET } from "./suppressions/route";
import { GET as countsGET } from "./suppressions/counts/route";

const ID = "5011eb15-74e9-4f7b-8b5d-192ff8f14aef";
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });

function req(path: string, headers: Record<string, string> = {}) {
  return new Request(`https://staging.example/api/admin/comm/${path}`, {
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
  m.rpc.mockResolvedValue({ data: { total: 0, rows: [] }, error: null });
});

describe("full flow (admin, cookie session)", () => {
  it("logs: maps query → comm_logs_list args, returns { ok, data }, never cached", async () => {
    m.rpc.mockResolvedValue({ data: { total: 1, rows: [{ id: ID }] }, error: null });
    const res = await logsGET(req("logs?from=2026-10-01&to=2026-10-07&channel=whatsapp&status=Completed&template=tpl_a&nature=Bulk&campaign=Oct&search=Job%23ab&sort=targeted&dir=asc&page=2&size=25"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.json()).toEqual({ ok: true, data: { total: 1, rows: [{ id: ID }] } });
    expect(m.rpc).toHaveBeenCalledWith("comm_logs_list", {
      p_from: "2026-10-01T00:00:00+05:30", p_to: "2026-10-08T00:00:00+05:30", p_channel: "whatsapp", p_status: "Completed",
      p_template: "tpl_a", p_nature: "Bulk", p_campaign: "Oct", p_search: "Job#ab", p_sort: "targeted", p_dir: "asc", p_page: 2, p_size: 25,
    });
  });

  it("logs: no dates → last 90 days; every arg is passed (nulls for the rest)", async () => {
    await logsGET(req("logs"));
    const args = m.rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.keys(args).sort()).toEqual(["p_campaign", "p_channel", "p_dir", "p_from", "p_nature", "p_page", "p_search", "p_size", "p_sort", "p_status", "p_template", "p_to"]);
    expect(args.p_page).toBe(1); expect(args.p_size).toBe(10);
    const days = (Date.parse(String(args.p_to)) - Date.parse(String(args.p_from))) / 86_400_000;
    expect(days).toBe(90);
  });

  it("options, one job, recipients, failures, performance, suppressions, counts call the right function", async () => {
    m.rpc.mockResolvedValue({ data: { job: { id: ID }, subject: null }, error: null });
    await optionsGET(req("logs/options"));
    await oneGET(req(`logs/${ID}`), ctx());
    await recipientsGET(req(`logs/${ID}/recipients?status=Failed&search=9000&page=1&size=10`), ctx());
    await failuresGET(req(`logs/${ID}/failures`), ctx());
    await perfGET(req("performance?from=2026-10-01&to=2026-10-31&channel=email&template=t"));
    await supGET(req("suppressions?channel=WhatsApp&sort=stamp&dir=desc"));
    await countsGET(req("suppressions/counts?channel=Email&search=x"));
    expect(m.rpc.mock.calls.map((c) => c[0])).toEqual([
      "comm_logs_options", "comm_log_get", "comm_log_recipients", "comm_log_failures", "comm_performance", "comm_suppressions_list", "comm_suppressions_counts",
    ]);
    expect(m.rpc.mock.calls[2][1]).toMatchObject({ p_id: ID, p_status: "Failed", p_search: "9000", p_from: null, p_to: null });
    expect(m.rpc.mock.calls[5][1]).toMatchObject({ p_channel: "WhatsApp", p_reason: null, p_from: null, p_to: null, p_sort: "stamp" });
  });

  it("Bearer token: uses a token client with that header (API clients)", async () => {
    const res = await logsGET(req("logs", { authorization: "Bearer test-token" }));
    expect(res.status).toBe(200);
    expect(m.getUser).toHaveBeenCalledWith("test-token");
    expect(m.clients.some((c) => JSON.stringify(c.opts).includes("Bearer test-token"))).toBe(true);
  });

  it("rate limits are keyed by trusted IP and by user, on the private limiter", async () => {
    await logsGET(req("logs"));
    expect(m.rateHit).toHaveBeenCalledWith("pp_rate_hit", { p_key: "comm_read:ip:203.0.113.7", p_max: 300, p_window: 60 });
    expect(m.rateHit).toHaveBeenCalledWith("pp_rate_hit", { p_key: "comm_read:user:admin-1", p_max: 120, p_window: 60 });
  });
});

describe("failure paths", () => {
  it("one job not found → 404", async () => {
    m.rpc.mockResolvedValue({ data: { job: null, subject: null }, error: null });
    const res = await oneGET(req(`logs/${ID}`), ctx());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, code: "NOT_FOUND" });
  });
  it("database error → 500 SERVER without leaking the message", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "relation secret_table does not exist" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await logsGET(req("logs"));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("secret_table");
    expect(JSON.parse(text)).toEqual({ ok: false, code: "SERVER" });
    expect(JSON.stringify(spy.mock.calls)).not.toContain("secret_table");
    spy.mockRestore();
  });
  it("database says range too long (direct check) → 400 RANGE_TOO_LONG", async () => {
    m.rpc.mockResolvedValue({ data: null, error: { code: "22023", message: "range_too_long" } });
    const res = await logsGET(req("logs"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, code: "RANGE_TOO_LONG" });
  });
  it("rate limiter unavailable (service key missing / DB error) → 503, nothing else runs", async () => {
    m.rateHit.mockResolvedValue({ data: null, error: { message: "down" } });
    const res = await logsGET(req("logs"));
    expect(res.status).toBe(503);
    expect(m.getUser).not.toHaveBeenCalled();
    expect(m.rpc).not.toHaveBeenCalled();
  });
});

describe("break-it", () => {
  it("no token / no session → 401, the comm function is never called", async () => {
    m.getUser.mockResolvedValue({ data: { user: null }, error: { message: "no session" } });
    for (const r of [logsGET(req("logs")), perfGET(req("performance")), supGET(req("suppressions?channel=Email")), oneGET(req(`logs/${ID}`), ctx())]) {
      const res = await r;
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ ok: false, code: "NOT_LOGGED_IN" });
    }
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("logged in but not admin → 403 (the database refuses with 42501)", async () => {
    m.getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
    m.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "forbidden" } });
    for (const r of [logsGET(req("logs")), countsGET(req("suppressions/counts?channel=Email")), failuresGET(req(`logs/${ID}/failures`), ctx())]) {
      const res = await r;
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ ok: false, code: "FORBIDDEN" });
    }
  });

  it("huge page size, page 0, unknown keys, repeated keys → 400 before the database", async () => {
    for (const qs of ["size=100000", "size=101", "page=0", "p_size=1000", "created_by=x", "channel=email&channel=whatsapp", "sort=1;drop", "search=" + "a".repeat(500)]) {
      const res = await logsGET(req(`logs?${qs}`));
      expect(res.status, qs).toBe(400);
    }
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("bad dates → 400: wrong format, impossible date, reversed, one side only, more than 90 days", async () => {
    const cases: [string, string][] = [
      ["from=01/10/2026&to=07/10/2026", "INVALID"], ["from=2026-02-30&to=2026-03-02", "INVALID"],
      ["from=2026-10-07&to=2026-10-01", "INVALID"], ["from=2026-10-01", "INVALID"], ["to=2026-10-01", "INVALID"],
      ["from=2026-01-01&to=2026-12-31", "RANGE_TOO_LONG"],
    ];
    for (const [qs, code] of cases) {
      const res = await logsGET(req(`logs?${qs}`));
      expect(res.status, qs).toBe(400);
      expect((await res.json()).code, qs).toBe(code);
      const p = await perfGET(req(`performance?${qs}`));
      expect(p.status, qs).toBe(400);
    }
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("changed / malformed ids → 400 (never sent to the database)", async () => {
    for (const id of ["1", "../../suppressions", "5011eb15-74e9-4f7b-8b5d-192ff8f14aef' or '1'='1", "%00"]) {
      expect((await oneGET(req("logs/x"), ctx(id))).status, id).toBe(400);
      expect((await recipientsGET(req("logs/x/recipients"), ctx(id))).status, id).toBe(400);
    }
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("protected fields cannot be smuggled in (p_*, created_by, role)", async () => {
    for (const qs of ["p_page=1", "role=admin", "created_by=" + ID, "p_from=2020-01-01T00:00:00Z"]) {
      expect((await supGET(req(`suppressions?channel=Email&${qs}`))).status, qs).toBe(400);
    }
  });

  it("rapid repeat: once the limiter says no → 429, the database function is not called", async () => {
    let calls = 0;
    m.rateHit.mockImplementation(async (_fn: string, args: { p_key: string }) => {
      if (args.p_key.startsWith("comm_read:user:")) calls++;
      return { data: calls <= 3, error: null };
    });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await logsGET(req("logs"))).status);
    expect(codes).toEqual([200, 200, 200, 429, 429]);
    expect(m.rpc).toHaveBeenCalledTimes(3);
  });

  it("IP flood: per-IP limit answers 429 before any login check", async () => {
    m.rateHit.mockResolvedValue({ data: false, error: null });
    const res = await logsGET(req("logs"));
    expect(res.status).toBe(429);
    expect(m.getUser).not.toHaveBeenCalled();
  });

  it("cross-site browser request (Sec-Fetch-Site: cross-site) → 403", async () => {
    const res = await logsGET(req("logs", { "sec-fetch-site": "cross-site" }));
    expect(res.status).toBe(403);
    expect(m.getUser).not.toHaveBeenCalled();
  });

  it("no trusted IP on Vercel → refused (fails closed)", async () => {
    process.env.VERCEL = "1";
    try {
      const r = new Request("https://staging.example/api/admin/comm/logs", { headers: { host: "staging.example" } });
      expect((await logsGET(r)).status).toBe(429);
    } finally {
      delete process.env.VERCEL;
    }
  });
});
