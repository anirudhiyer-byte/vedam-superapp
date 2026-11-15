/** Slice 8 · Manage Automation on live data (read-only): mapping, client-side search / filter / sort / page, tiles, options, blocked writes. */
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import {
  AUTOMATION_NOT_LIVE, automationCounts, automationOptions, automationStatus, automationView, liveAutomationsApi, queryAutomations,
  toAutomationRows, type LiveAutomation,
} from "./live-automation";
import { AUTOMATION_LIVE, LIVE_PAGES, LIVE_WRITES, canWriteLive, isLivePage, liveNote } from "./live-config";

const NOW = new Date("2026-11-06T08:00:00Z");
const base: LiveAutomation = {
  engine: "whatsapp", id: "5011eb15-74e9-4f7b-8b5d-192ff8f14aef", name: "ZZ reminder", enabled: true, channel: "whatsapp", trigger: "scheduled",
  product: null, created_at: "2026-11-01T09:15:00Z", last_run_at: "2026-11-05T10:44:00Z", runs: 2, last_sent: 3, last_failed: 2, last_status: "partial",
};
const journey: LiveAutomation = {
  engine: "journey", id: "8c0f2b7a-1d2e-4f3a-9b8c-7d6e5f4a3b2c", name: "ZZ journey", enabled: false, channel: "email", trigger: "conditions",
  product: "codesprint", created_at: "2026-10-20T04:30:00Z", last_run_at: null, runs: 0, last_sent: null, last_failed: null, last_status: "never",
};
const fetchMock = vi.fn();
const okBody = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ ok: true, data }) });

beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); liveAutomationsApi.forget(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("status rule", () => {
  it("enabled and the end date not passed (or no end date) → Active", () => {
    expect(automationStatus(true, null, NOW)).toBe("Active");
    expect(automationStatus(true, "2026-12-01T00:00:00Z", NOW)).toBe("Active");
  });
  it("enabled but the end date has passed → Completed", () => {
    expect(automationStatus(true, "2026-11-01T00:00:00Z", NOW)).toBe("Completed");
  });
  it("disabled → Pause (whatever the end date)", () => {
    expect(automationStatus(false, null, NOW)).toBe("Pause");
    expect(automationStatus(false, "2026-11-01T00:00:00Z", NOW)).toBe("Pause");
  });
  it("a broken end date is ignored (no crash, stays Active)", () => {
    expect(automationStatus(true, "not-a-date", NOW)).toBe("Active");
  });
});

describe("mapping to AutomationRow", () => {
  it("WhatsApp automation: short id, name, module, audience, trigger, created on (India time), '-' for what the tables do not have", () => {
    const [r] = toAutomationRows([base], NOW);
    expect(r).toEqual({
      id: "W-5011eb15", name: "ZZ reminder", module: "Automation · WhatsApp", list: "All users", trigger: "Scheduled",
      createdOn: "01/11/2026 02:45 PM", createdBy: "-", startDate: "-", endDate: "-", status: "Active", tags: [],
      lastRun: "05/11/2026 04:14 PM · 3 sent, 2 failed",
    });
  });
  it("journey: J- id, Pause when disabled, product becomes a tag, never ran", () => {
    const [r] = toAutomationRows([journey], NOW);
    expect(r).toMatchObject({ id: "J-8c0f2b7a", module: "Journey · Email", list: "All users", trigger: "Audience conditions", status: "Pause", tags: ["codesprint"], lastRun: "Never" });
  });
  it("triggers and audiences for every engine value", () => {
    const rows = toAutomationRows([
      { ...base, id: "a1111111-0000-4000-8000-000000000001", trigger: "event_before" },
      { ...base, id: "a2222222-0000-4000-8000-000000000002", trigger: "event_after", channel: "email" },
      { ...base, id: "a3333333-0000-4000-8000-000000000003", trigger: "other", channel: "other" },
    ], NOW);
    expect(rows.map((r) => [r.trigger, r.list, r.module])).toEqual([
      ["Before an event", "Event registrants", "Automation · WhatsApp"],
      ["After an event", "Event registrants", "Automation · Email"],
      ["Other", "-", "Automation · Other"],
    ]);
  });
  it("last run text: sent only, failed only, nothing sent, journey count, ran but no time", () => {
    const t = (x: Partial<LiveAutomation>) => toAutomationRows([{ ...base, ...x }], NOW)[0].lastRun;
    expect(t({ last_sent: 4, last_failed: 0, last_status: "sent" })).toBe("05/11/2026 04:14 PM · 4 sent");
    expect(t({ last_sent: 0, last_failed: 7, last_status: "failed" })).toBe("05/11/2026 04:14 PM · 7 failed");
    expect(t({ last_sent: 0, last_failed: 0, last_status: "none" })).toBe("05/11/2026 04:14 PM · nobody to send to");
    expect(toAutomationRows([{ ...journey, runs: 12, last_status: "fired", last_run_at: "2026-11-05T10:44:00Z" }], NOW)[0].lastRun).toBe("05/11/2026 04:14 PM · 12 messages so far");
    expect(t({ last_run_at: null })).toBe("3 sent, 2 failed");
  });
  it("ids: two rows whose first 8 characters clash keep their full id (still unique)", () => {
    const rows = toAutomationRows([{ ...base, id: "5011eb15-0000-4000-8000-000000000001" }, { ...base, id: "5011eb15-0000-4000-8000-000000000002" }, journey], NOW);
    expect(rows.map((r) => r.id)).toEqual(["W-5011eb15-0000-4000-8000-000000000001", "W-5011eb15-0000-4000-8000-000000000002", "J-8c0f2b7a"]);
    expect(new Set(rows.map((r) => r.id)).size).toBe(3);
  });
  it("whitelist: unknown extra fields from the server are never copied onto the row", () => {
    const sneaky = { ...base, template_id: "zz_secret", phone: "9000000399", email: "zz@example.invalid" } as LiveAutomation;
    const text = JSON.stringify(toAutomationRows([sneaky], NOW));
    expect(text).not.toContain("zz_secret");
    expect(text).not.toContain("9000000399");
    expect(text).not.toContain("example.invalid");
  });
  it("odd values: missing date, negative / non-number counts → '-' and 0, no crash", () => {
    const [r] = toAutomationRows([{ ...base, created_at: null, last_run_at: null, last_sent: -1 as unknown as number, last_failed: "x" as unknown as number }], NOW);
    expect(r.createdOn).toBe("-");
    expect(r.lastRun).toBe("Never");
  });
});

describe("client-side query (search, filters, sort, page)", () => {
  const many: LiveAutomation[] = Array.from({ length: 23 }, (_, i) => ({
    ...base, id: `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`, name: `ZZ auto ${String(i).padStart(2, "0")}`,
    enabled: i % 3 !== 0, trigger: i % 2 ? "event_before" : "scheduled", created_at: new Date(Date.UTC(2026, 9, 1 + i, 6, 0)).toISOString(),
  }));
  const rows = toAutomationRows([...many, journey], NOW);

  it("paging: 10 per page, total counts every match", () => {
    const p1 = queryAutomations(rows, { page: 1, pageSize: 10 });
    const p3 = queryAutomations(rows, { page: 3, pageSize: 10 });
    expect(p1.total).toBe(24);
    expect(p1.rows).toHaveLength(10);
    expect(p3.rows).toHaveLength(4);
  });
  it("search matches name, id and trigger (case-insensitive); special characters are plain text", () => {
    expect(queryAutomations(rows, { search: "zz AUTO 1" }).total).toBe(10);       // 10..19
    expect(queryAutomations(rows, { search: "J-8c0f" }).rows[0].name).toBe("ZZ journey");
    expect(queryAutomations(rows, { search: "audience" }).total).toBe(1);
    expect(queryAutomations(rows, { search: "'; drop table x; --" }).total).toBe(0);
    expect(queryAutomations(rows, { search: ".*" }).total).toBe(0);
  });
  it("filters: status, module, list, trigger, tags; empty value is ignored", () => {
    expect(queryAutomations(rows, { filters: { status: "Pause" } }).total).toBe(9);   // 8 disabled autos + the journey
    expect(queryAutomations(rows, { filters: { module: "Journey · Email" } }).total).toBe(1);
    expect(queryAutomations(rows, { filters: { trigger: "Before an event", status: "Active" } }).rows.every((r) => r.trigger === "Before an event" && r.status === "Active")).toBe(true);
    expect(queryAutomations(rows, { filters: { list: "Event registrants" } }).total).toBe(11);
    expect(queryAutomations(rows, { filters: { tags: "codesprint" } }).total).toBe(1);
    expect(queryAutomations(rows, { filters: { status: "" } }).total).toBe(24);
  });
  it("created-on date range (India dates, both ends included)", () => {
    expect(queryAutomations(rows, { filters: { createdOn: "2026-10-01..2026-10-03" } }).total).toBe(3);
    expect(queryAutomations(rows, { filters: { createdOn: "2026-10-20" } }).total).toBe(2);   // auto 19 + the journey
  });
  it("start / end date filters find nothing (the tables have no such dates)", () => {
    expect(queryAutomations(rows, { filters: { startDate: "2026-10-01..2026-12-01" } }).total).toBe(0);
  });
  it("default order newest first; sort by name and by created on (real dates, not text)", () => {
    expect(queryAutomations(rows, { pageSize: 1 }).rows[0].name).toBe("ZZ auto 22");
    expect(queryAutomations(rows, { sortKey: "name", sortDir: "asc", pageSize: 1 }).rows[0].name).toBe("ZZ auto 00");
    expect(queryAutomations(rows, { sortKey: "createdOn", sortDir: "asc", pageSize: 1 }).rows[0].name).toBe("ZZ auto 00");
    expect(queryAutomations(rows, { sortKey: "createdOn", sortDir: "desc", pageSize: 1 }).rows[0].name).toBe("ZZ auto 22");
  });
  it("tiles: follow search and filters except Status; Draft and Stopped are always 0", () => {
    const c = automationCounts(rows, { filters: { status: "Active", trigger: "Scheduled" } });
    expect(c).toMatchObject({ Draft: 0, Stopped: 0, Completed: 0 });
    expect(c.Active + c.Pause).toBe(12);
    expect(c.total).toBe(12);
  });
  it("filter options come from the same rows", () => {
    const o = automationOptions(rows);
    expect(o.status.map((x) => x.value)).toEqual(["Active", "Draft", "Pause", "Completed", "Stopped"]);
    expect(o.module.map((x) => x.value)).toEqual(["Automation · WhatsApp", "Journey · Email"]);
    expect(o.trigger.map((x) => x.value)).toEqual(["Audience conditions", "Before an event", "Scheduled"]);
    expect(o.list.map((x) => x.value)).toEqual(["All users", "Event registrants"]);
    expect(o.tags.map((x) => x.value)).toEqual(["codesprint"]);
    expect(o.createdBy).toEqual([]);
  });
});

describe("live client (one GET for rows, tiles and options)", () => {
  it("list + options + counts on one page load = ONE request to /api/admin/comm/automation", async () => {
    fetchMock.mockResolvedValue(okBody({ total: 2, truncated: false, rows: [base, journey] }));
    const [page, opts] = await Promise.all([liveAutomationsApi.list({ page: 1, pageSize: 10 }), liveAutomationsApi.options()]);
    const counts = await liveAutomationsApi.counts({});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/admin/comm/automation");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: "same-origin", cache: "no-store" });
    expect(page.total).toBe(2);
    expect(opts.module).toHaveLength(2);
    expect(counts).toMatchObject({ Active: 1, Pause: 1, Draft: 0, Stopped: 0, Completed: 0, total: 2 });
  });
  it("Refresh (a new list call later) asks the server again", async () => {
    fetchMock.mockResolvedValue(okBody({ total: 1, truncated: false, rows: [base] }));
    await liveAutomationsApi.list({ page: 1, pageSize: 10 });
    liveAutomationsApi.forget();
    await liveAutomationsApi.list({ page: 1, pageSize: 10 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("empty tables → empty page, all tiles 0", async () => {
    fetchMock.mockResolvedValue(okBody({ total: 0, truncated: false, rows: [] }));
    expect(await liveAutomationsApi.list({ page: 1, pageSize: 10 })).toMatchObject({ rows: [], total: 0 });
    expect(await liveAutomationsApi.counts({})).toMatchObject({ Active: 0, Draft: 0, Pause: 0, Completed: 0, Stopped: 0, total: 0 });
  });
  it("server error → a plain message, never the server text", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({ ok: false, code: "FORBIDDEN", message: "secret detail" }) });
    await expect(liveAutomationsApi.list({ page: 1, pageSize: 10 })).rejects.toThrow("You do not have access to this data.");
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({ ok: false, code: "SERVER" }) });
    liveAutomationsApi.forget();
    await expect(liveAutomationsApi.list({ page: 1, pageSize: 10 })).rejects.toThrow("Could not load the data. Try again.");
  });
  it("a failed load is not cached: the next call tries again", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(okBody({ total: 1, truncated: false, rows: [base] }));
    await expect(liveAutomationsApi.list({ page: 1, pageSize: 10 })).rejects.toThrow();
    expect((await liveAutomationsApi.list({ page: 1, pageSize: 10 })).total).toBe(1);
  });
  it("every write says it is not available on live data yet, and sends nothing", async () => {
    const all = [
      liveAutomationsApi.create({ category: "Lead", trigger: "On Creation", module: "Lead", conditions: [] }),
      liveAutomationsApi.setStatus(["W-5011eb15"], "Pause"), liveAutomationsApi.setStatus(["W-5011eb15"], "Active"),
      liveAutomationsApi.setStatus(["W-5011eb15"], "Stopped"), liveAutomationsApi.remove(["W-5011eb15"]),
      liveAutomationsApi.duplicate("W-5011eb15"), liveAutomationsApi.rename("W-5011eb15", "x"), liveAutomationsApi.publish("W-5011eb15"),
      liveAutomationsApi.get("W-5011eb15"), liveAutomationsApi.logs("W-5011eb15", {}),
    ];
    for (const p of all) await expect(p).rejects.toThrow(AUTOMATION_NOT_LIVE);
    expect(AUTOMATION_NOT_LIVE).toBe("This action is not available on live data yet.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("flag", () => {
  it("AUTOMATION_LIVE is on: Manage Automation reads live data, read-only", () => {
    expect(AUTOMATION_LIVE).toBe(true);
    expect(LIVE_PAGES.automation).toBe(true);
    expect(isLivePage("automation")).toBe(true);
    expect(automationView()).toBe("live");
    expect(canWriteLive("automation")).toBe(false);
    expect((LIVE_WRITES as Record<string, boolean>).automation).toBeUndefined();
    expect(liveNote("automation")).toBe("read-only: create, edit, pause and delete are not available yet.");
  });
  it("flag forced OFF: the page is the old sample-data page (view 'mock')", async () => {
    vi.doMock("./live-config", async (orig) => ({ ...(await orig<typeof import("./live-config")>()), AUTOMATION_LIVE: false }));
    onTestFinished(() => { vi.doUnmock("./live-config"); vi.resetModules(); });
    vi.resetModules();
    const off = await import("./live-automation");
    expect(off.automationView()).toBe("mock");
  });
});
