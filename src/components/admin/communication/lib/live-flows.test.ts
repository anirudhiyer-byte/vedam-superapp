/** Slice 6 · WhatsApp Flow drafts on live data: mapping, client-side filters, create-from, blocked status, flag. */
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { FLOW_NOT_LIVE, flowsView, liveFlowsApi, toFlowRow, type LiveFlow } from "./live-flows";
import { DEFAULT_FLOW_CATEGORIES, RECOMMENDED_FLOWS, SCREEN_DETAILS } from "./flow-recommended";
import { FLOWS_LIVE, LIVE_PAGES, isLivePage, liveNote } from "./live-config";

const ID = "7b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";
const ID2 = "8c0f2b7a-1d2e-4f3a-9b8c-7d6e5f4a3b2c";
const row = (over: Partial<LiveFlow> = {}): LiveFlow => ({ id: ID, name: "ZZ VSAT slot", description: "book a slot", module: "Leads", category: "Admissions",
  status: "Draft", created_at: "2026-11-06T06:30:00Z", screen_count: 1, ...over });
const LIST = { total: 3, categories: ["Admissions", "ZZ Scholarships"], rows: [
  row(), row({ id: ID2, name: "ZZ Fee reminder", category: "ZZ Scholarships", module: "Raw Data", created_at: "2026-11-05T06:30:00Z", status: "Inactive" }),
  row({ id: "9d1e2f3a-4b5c-4d6e-8f7a-1b2c3d4e5f6a", name: "ZZ Old", created_at: "2026-10-01T06:30:00Z" }),
] };
const SCREENS = [{ id: "screen_one", title: "Pick a slot", cta: "Next", fields: [{ label: "Preferred date", kind: "date" as const }] }];
const fetchMock = vi.fn();
const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ ok: true, data }) });
const fail = (status: number, code: string) => ({ ok: false, status, json: async () => ({ ok: false, code, message: "secret detail" }) });
const call = (i: number) => ({ url: String(fetchMock.mock.calls[i][0]), init: (fetchMock.mock.calls[i][1] ?? {}) as RequestInit });
const NEW = { name: "ZZ New flow", module: "Leads" as const, category: "Admissions", description: "collects details" };

beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); liveFlowsApi.forget(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("mapping", () => {
  it("live row → FlowRow: scope mine, tag = module, India-time created on, status kept", () => {
    expect(toFlowRow(row())).toEqual({ id: ID, name: "ZZ VSAT slot", description: "book a slot", tag: "Leads", category: "Admissions",
      scope: "mine", createdOn: "06/11/2026, 12:00 PM", status: "Draft", module: "Leads" });
    expect(toFlowRow(row({ status: "Inactive" })).status).toBe("Inactive");
  });
  it("whitelist: extra fields from the server (owner, screens) are not copied", () => {
    const r = toFlowRow({ ...row(), owner_id: "00000000-0000-4000-8000-000000000009", screens: SCREENS } as LiveFlow);
    expect(JSON.stringify(r)).not.toContain("00000000-0000-4000-8000-000000000009");
    expect(r.screens).toBeUndefined();
  });
});

describe("list", () => {
  it("Recommended (default scope) comes from the app's code: f1, f2, no request", async () => {
    const p = await liveFlowsApi.list({});
    expect(p.rows.map((r) => r.id)).toEqual(["f1", "f2"]);
    expect(p.rows.every((r) => r.scope === "recommended")).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("My Flow: one GET to /api/admin/comm/flows, newest first", async () => {
    fetchMock.mockResolvedValue(ok(LIST));
    const p = await liveFlowsApi.list({ filters: { scope: "mine" } });
    expect(call(0).url).toBe("/api/admin/comm/flows");
    expect(p.total).toBe(3);
    expect(p.rows.map((r) => r.name)).toEqual(["ZZ VSAT slot", "ZZ Fee reminder", "ZZ Old"]);
  });
  it("My Flow: search (name, description, tag), category and status filters run in the browser", async () => {
    fetchMock.mockResolvedValue(ok(LIST));
    expect((await liveFlowsApi.list({ search: "fee", filters: { scope: "mine" } })).total).toBe(1);
    expect((await liveFlowsApi.list({ search: "raw data", filters: { scope: "mine" } })).total).toBe(1);
    expect((await liveFlowsApi.list({ filters: { scope: "mine", category: "Admissions" } })).total).toBe(2);
    expect((await liveFlowsApi.list({ filters: { scope: "mine", status: "Draft" } })).total).toBe(2);
    expect((await liveFlowsApi.list({ filters: { scope: "mine", status: "Active" } })).total).toBe(0);
    expect((await liveFlowsApi.list({ search: "'; drop table comm_flows; --", filters: { scope: "mine" } })).total).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);   // kept for a moment: filters do not ask again
  });
  it("Recommended search / status filter work the same way (local)", async () => {
    expect((await liveFlowsApi.list({ search: "miss call" })).rows.map((r) => r.id)).toEqual(["f2"]);
    expect((await liveFlowsApi.list({ filters: { status: "Draft" } })).total).toBe(0);
  });
  it("empty My Flow → empty page; server error → plain message", async () => {
    fetchMock.mockResolvedValue(ok({ total: 0, categories: [], rows: [] }));
    expect(await liveFlowsApi.list({ filters: { scope: "mine" } })).toMatchObject({ rows: [], total: 0 });
    liveFlowsApi.forget();
    fetchMock.mockResolvedValue(fail(500, "SERVER"));
    await expect(liveFlowsApi.list({ filters: { scope: "mine" } })).rejects.toThrow("Could not load the data. Try again.");
  });
});

describe("categories", () => {
  it("defaults + the categories live flows use (no duplicates, any case)", async () => {
    fetchMock.mockResolvedValue(ok({ ...LIST, categories: ["admissions", "ZZ Scholarships"] }));
    expect(await liveFlowsApi.categories()).toEqual([...DEFAULT_FLOW_CATEGORIES, "ZZ Scholarships"]);
    expect((await liveFlowsApi.options()).category.map((o) => o.value)).toEqual([...DEFAULT_FLOW_CATEGORIES, "ZZ Scholarships"]);
    expect((await liveFlowsApi.options()).status.map((o) => o.value)).toEqual(["Active", "Draft"]);
  });
  it("addCategory only checks the name (nothing is saved until a flow uses it)", async () => {
    fetchMock.mockResolvedValue(ok(LIST));
    expect(await liveFlowsApi.addCategory("  ZZ Hostel  ")).toBe("ZZ Hostel");
    await expect(liveFlowsApi.addCategory("lead nurturing")).rejects.toThrow("This category already exists.");
    await expect(liveFlowsApi.addCategory("ZZ <b>")).rejects.toThrow();
    await expect(liveFlowsApi.addCategory("c".repeat(41))).rejects.toThrow();
    expect(fetchMock.mock.calls.every((c) => !c[1] || !(c[1] as RequestInit).method || (c[1] as RequestInit).method === "GET")).toBe(true);
  });
});

describe("preview", () => {
  it("Recommended: local screens, no request", async () => {
    expect(await liveFlowsApi.preview("f2")).toEqual({ name: "Miss Call Data Flow", screens: RECOMMENDED_FLOWS[1].screens });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("live flow: GET /flows/:id", async () => {
    fetchMock.mockResolvedValue(ok({ ...row(), screens: SCREENS }));
    expect(await liveFlowsApi.preview(ID)).toEqual({ name: "ZZ VSAT slot", screens: SCREENS });
    expect(call(0).url).toBe(`/api/admin/comm/flows/${ID}`);
  });
  it("unknown non-uuid id (e.g. a sample id f3) → message, no request", async () => {
    await expect(liveFlowsApi.preview("f3")).rejects.toThrow("This flow no longer exists.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("create", () => {
  const sent = (i: number) => JSON.parse(String(call(i).init.body)) as Record<string, unknown>;
  it("no fromId → the default screen, Draft row back", async () => {
    fetchMock.mockResolvedValue(ok(row({ name: "ZZ New flow" })));
    const r = await liveFlowsApi.create(NEW);
    expect(call(0).url).toBe("/api/admin/comm/flows");
    expect(call(0).init.method).toBe("POST");
    expect(sent(0)).toEqual({ ...NEW, screens: [SCREEN_DETAILS] });
    expect(r).toMatchObject({ name: "ZZ New flow", scope: "mine", status: "Draft" });
  });
  it("from a Recommended flow → its screens are copied locally; the id f1 is never sent", async () => {
    fetchMock.mockResolvedValue(ok(row()));
    await liveFlowsApi.create({ ...NEW, fromId: "f2" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sent(0).screens).toEqual(RECOMMENDED_FLOWS[1].screens);
    expect(String(call(0).init.body)).not.toContain("f2");
    expect(sent(0)).not.toHaveProperty("fromId");
  });
  it("from a live flow → GET its screens first, then POST them", async () => {
    fetchMock.mockResolvedValueOnce(ok({ ...row(), screens: SCREENS })).mockResolvedValueOnce(ok(row({ id: ID2 })));
    await liveFlowsApi.create({ ...NEW, fromId: ID });
    expect(call(0).url).toBe(`/api/admin/comm/flows/${ID}`);
    expect(call(1).init.method).toBe("POST");
    expect(sent(1).screens).toEqual(SCREENS);
  });
  it("name already used (409) → a message about the name (the drawer shows it under Name)", async () => {
    fetchMock.mockResolvedValue(fail(409, "CONFLICT"));
    await expect(liveFlowsApi.create(NEW)).rejects.toThrow(/name/i);
  });
  it("bad input is refused in the browser first (same rules as the server), nothing sent", async () => {
    await expect(liveFlowsApi.create({ ...NEW, name: "ZZ <script>" })).rejects.toThrow();
    await expect(liveFlowsApi.create({ ...NEW, description: "d".repeat(301) })).rejects.toThrow();
    await expect(liveFlowsApi.create({ ...NEW, fromId: "f9" })).rejects.toThrow("This flow no longer exists.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("after create the next My Flow list asks the server again", async () => {
    fetchMock.mockResolvedValue(ok(LIST));
    await liveFlowsApi.list({ filters: { scope: "mine" } });
    fetchMock.mockResolvedValueOnce(ok(row()));
    await liveFlowsApi.create(NEW);
    fetchMock.mockResolvedValue(ok(LIST));
    await liveFlowsApi.list({ filters: { scope: "mine" } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("duplicate, delete, status", () => {
  it("duplicate: POST /flows/:id/duplicate; delete: DELETE /flows/:id", async () => {
    fetchMock.mockResolvedValueOnce(ok(row({ id: ID2, name: "Copy of ZZ VSAT slot" }))).mockResolvedValueOnce(ok({ id: ID, deleted: true }));
    expect((await liveFlowsApi.duplicate(ID)).name).toBe("Copy of ZZ VSAT slot");
    expect(call(0)).toMatchObject({ url: `/api/admin/comm/flows/${ID}/duplicate`, init: { method: "POST" } });
    await liveFlowsApi.remove(ID);
    expect(call(1)).toMatchObject({ url: `/api/admin/comm/flows/${ID}`, init: { method: "DELETE" } });
  });
  it("Recommended ids are never sent for duplicate / delete", async () => {
    await expect(liveFlowsApi.duplicate("f1")).rejects.toThrow();
    await expect(liveFlowsApi.remove("f2")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("deleted meanwhile (404) → 'This flow no longer exists.'", async () => {
    fetchMock.mockResolvedValue(fail(404, "NOT_FOUND"));
    await expect(liveFlowsApi.remove(ID)).rejects.toThrow("This flow no longer exists.");
  });
  it("Activate / Deactivate: not available on live data yet, nothing sent", async () => {
    await expect(liveFlowsApi.setStatus(ID, "Active")).rejects.toThrow(FLOW_NOT_LIVE);
    await expect(liveFlowsApi.setStatus(ID, "Draft")).rejects.toThrow(FLOW_NOT_LIVE);
    expect(FLOW_NOT_LIVE).toBe("This action is not available on live data yet.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("flag", () => {
  it("FLOWS_LIVE is on: WhatsApp Flow saves drafts on live data", () => {
    expect(FLOWS_LIVE).toBe(true);
    expect(LIVE_PAGES.whatsappFlow).toBe(true);
    expect(isLivePage("whatsappFlow")).toBe(true);
    expect(flowsView()).toBe("live");
    expect(liveNote("whatsappFlow")).toBe("saved as drafts only, nothing is sent or published.");
  });
  it("flag forced OFF: the page is the old sample page (view 'mock')", async () => {
    vi.doMock("./live-config", async (orig) => ({ ...(await orig<typeof import("./live-config")>()), FLOWS_LIVE: false }));
    onTestFinished(() => { vi.doUnmock("./live-config"); vi.resetModules(); });
    vi.resetModules();
    const off = await import("./live-flows");
    expect(off.flowsView()).toBe("mock");
  });
});
