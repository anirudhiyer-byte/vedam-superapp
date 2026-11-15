import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn(), adminRpc: vi.fn(), fetch: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: m.getUser }, rpc: m.rpc }) }));
vi.mock("@/lib/supabase/service", () => ({ adminDb: () => ({ rpc: m.adminRpc }) }));

import { POST } from "./route";

const RUN = "7c0f8b1e-3a3b-4c1d-9f3e-2b1a0c9d8e7f";
const APP = "DUMMY-VSAT-00001";

function req(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://staging.example/api/vsat/profile", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { host: "staging.example", origin: "https://staging.example", "content-type": "application/json", ...headers },
  });
}
const aiOk = (text: string) => new Response(JSON.stringify({ content: [{ type: "text", text }] }), { status: 200 });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", m.fetch);
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  m.getUser.mockResolvedValue({ data: { user: { id: "u-1" } }, error: null });
  m.rpc.mockResolvedValue({ data: { run_id: RUN, fields: [["VPS (out of 10)", "8.4"], ["City", "Pune"]] }, error: null });
  m.adminRpc.mockResolvedValue({ data: { generated_at: "2026-11-13T10:00:00Z" }, error: null });
  m.fetch.mockResolvedValue(aiOk("• **Fit for Vedam** – moderate"));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("POST /api/vsat/profile", () => {
  it("starts as the user, calls the AI from the server, saves with the service role", async () => {
    const res = await POST(req({ application_id: APP }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, text: "• **Fit for Vedam** – moderate", generated_at: "2026-11-13T10:00:00Z", model: "claude-sonnet-5-5" });
    expect(m.rpc).toHaveBeenCalledWith("vsat_profile_start", { p_application_id: APP });
    const [url, init] = m.fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("test-key");
    const sent = JSON.parse(String(init.body)) as { messages: { content: string }[] };
    expect(sent.messages[0].content).toContain("VPS (out of 10): 8.4\nCity: Pune");
    expect(m.adminRpc).toHaveBeenCalledWith("vsat_profile_save", { p_run_id: RUN, p_text: "• **Fit for Vedam** – moderate", p_model: "claude-sonnet-5-5" });
  });

  it("CSRF: a request from another site is refused before anything runs", async () => {
    const res = await POST(req({ application_id: APP }, { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    expect(m.getUser).not.toHaveBeenCalled();
    expect(m.fetch).not.toHaveBeenCalled();
  });

  it("refuses a missing origin, a non-JSON body and a bad application id", async () => {
    const noOrigin = new Request("https://staging.example/api/vsat/profile", { method: "POST", body: JSON.stringify({ application_id: APP }),
      headers: { host: "staging.example", "content-type": "application/json" } });
    expect((await POST(noOrigin)).status).toBe(403);
    expect((await POST(req({ application_id: APP }, { "content-type": "text/plain" }))).status).toBe(415);
    for (const bad of [{}, { application_id: 5 }, { application_id: "x'; drop table--" }, { application_id: "a".repeat(65) }, "not json"]) {
      expect((await POST(req(bad))).status).toBe(400);
    }
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("not signed in → 401, nothing else runs", async () => {
    m.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await POST(req({ application_id: APP }));
    expect(res.status).toBe(401);
    expect(m.rpc).not.toHaveBeenCalled();
  });

  it("database refusals are passed on as codes, without calling the AI", async () => {
    for (const [code, status] of [["FORBIDDEN", 403], ["NEEDS_COUNSELLOR", 409], ["RATE_LIMITED", 429], ["IN_PROGRESS", 409]] as const) {
      m.rpc.mockResolvedValueOnce({ data: null, error: { message: code } });
      const res = await POST(req({ application_id: APP }));
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual({ ok: false, code });
    }
    m.rpc.mockResolvedValueOnce({ data: null, error: { message: 'relation "x" does not exist' } });
    const res = await POST(req({ application_id: APP }));
    expect(await res.json()).toEqual({ ok: false, code: "SERVER" });
    expect(m.fetch).not.toHaveBeenCalled();
  });

  it("no AI key → the run is closed and a clear code comes back", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const res = await POST(req({ application_id: APP }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, code: "AI_NOT_CONFIGURED" });
    expect(m.adminRpc).toHaveBeenCalledWith("vsat_profile_fail", { p_run_id: RUN, p_code: "AI_NOT_CONFIGURED" });
  });

  it("AI error, empty answer or network failure → AI_ERROR, nothing saved, no AI text leaked", async () => {
    m.fetch.mockResolvedValueOnce(new Response("upstream secret details", { status: 500 }));
    m.fetch.mockResolvedValueOnce(aiOk("   "));
    m.fetch.mockRejectedValueOnce(new Error("timeout"));
    for (let i = 0; i < 3; i++) {
      const res = await POST(req({ application_id: APP }));
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ ok: false, code: "AI_ERROR" });
    }
    expect(m.adminRpc).not.toHaveBeenCalledWith("vsat_profile_save", expect.anything());
    expect(m.adminRpc).toHaveBeenCalledWith("vsat_profile_fail", { p_run_id: RUN, p_code: "AI_ERROR" });
  });

  it("save failure → SERVER, and the run is marked failed", async () => {
    m.adminRpc.mockImplementation(async (fn: string) => (fn === "vsat_profile_save" ? { data: null, error: { message: "RUN_CLOSED" } } : { data: null, error: null }));
    const res = await POST(req({ application_id: APP }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, code: "SERVER" });
    expect(m.adminRpc).toHaveBeenCalledWith("vsat_profile_fail", { p_run_id: RUN, p_code: "SAVE_FAILED" });
  });
});
