/**
 * Live client for the 3 Slice-1 pages: talks to /api/admin/comm/* with fetch (faked here).
 * Full flow (request built → rows in the shapes the screens use) + failure paths.
 */
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { liveCommLogsApi, livePerformanceApi, liveSuppressionsApi } from "./live-api";

const ID = "5011eb15-74e9-4f7b-8b5d-192ff8f14aef";
const JOB = { id: ID, channel: "email", name: "Oct mail", kind: "campaign", template: "tpl_b", audience: "advanced", recipient_count: 2,
  created_at: "2026-10-02T04:30:00Z", scheduled_at: null, status: "Completed", sent: 2, delivered: 1, read: 1, clicked: 1, failed: 1 };

const fetchMock = vi.fn();
const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ ok: true, data }) });
const fail = (status: number, code: string) => ({ ok: false, status, json: async () => ({ ok: false, code }) });
const calledUrl = (i = 0) => new URL(String(fetchMock.mock.calls[i][0]), "https://x.example");

beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("communication logs (live)", () => {
  it("list: builds the request and returns Page<CommLogRow>", async () => {
    fetchMock.mockResolvedValue(ok({ total: 1, rows: [JOB] }));
    const p = await liveCommLogsApi.list({ page: 1, pageSize: 10, search: "Oct", filters: { channel: "email", startDate: "2026-10-01..2026-10-07" } });
    const u = calledUrl();
    expect(u.pathname).toBe("/api/admin/comm/logs");
    expect(Object.fromEntries(u.searchParams)).toEqual({ page: "1", size: "10", search: "Oct", channel: "email", from: "2026-10-01", to: "2026-10-07" });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: "same-origin", cache: "no-store" });
    expect(p.total).toBe(1);
    expect(p.rows[0]).toMatchObject({ id: ID, channel: "email", jobId: "Job#5011EB15", targeted: 2, delivered: 1 });
  });

  it("export (no page size): pages through 100 at a time and stops at the total", async () => {
    fetchMock
      .mockResolvedValueOnce(ok({ total: 150, rows: Array.from({ length: 100 }, (_, i) => ({ ...JOB, id: `${i}` })) }))
      .mockResolvedValueOnce(ok({ total: 150, rows: Array.from({ length: 50 }, (_, i) => ({ ...JOB, id: `b${i}` })) }));
    const p = await liveCommLogsApi.list({ search: "x" });
    expect(p.rows).toHaveLength(150);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(calledUrl(1).searchParams.get("page")).toBe("2");
    expect(calledUrl(1).searchParams.get("size")).toBe("100");
  });

  it("automation logs filter: live data has no automation jobs → empty page, no request", async () => {
    const p = await liveCommLogsApi.list({ filters: { automationId: "8910" } });
    expect(p).toMatchObject({ rows: [], total: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("options: templates from the server; filters the live data cannot answer are empty", async () => {
    fetchMock.mockResolvedValue(ok({ templates: ["tpl_a", "tpl_b"] }));
    const o = await liveCommLogsApi.options();
    expect(o.template).toEqual([{ value: "tpl_a", label: "tpl_a" }, { value: "tpl_b", label: "tpl_b" }]);
    expect(o.channel.map((x) => x.value)).toEqual(["email", "whatsapp"]);
    expect(o.form).toEqual([]); expect(o.sentBy).toEqual([]); expect(o.voiceType).toEqual([]);
  });

  it("preview, list name, stats, status detail, detailed report", async () => {
    fetchMock.mockResolvedValue(ok({ job: JOB, subject: "Hello" }));
    expect(await liveCommLogsApi.preview(ID)).toMatchObject({ kind: "email", title: "tpl_b", subject: "Hello" });
    expect(await liveCommLogsApi.listLabels(ID)).toEqual(["advanced"]);
    expect(await liveCommLogsApi.detailStats(ID)).toMatchObject({ sent: 2, delivered: 1, failed: 1, clicked: 1 });
    fetchMock.mockResolvedValueOnce(ok([{ rid: "r1", reason: "Bounced", at: "2026-10-02T04:30:00Z" }]));
    expect(await liveCommLogsApi.statusDetail(ID)).toEqual([{ id: "r1", status: "Bounced", date: "02 Oct 2026 10:00 am" }]);
    expect(calledUrl(fetchMock.mock.calls.length - 1).pathname).toBe(`/api/admin/comm/logs/${ID}/failures`);
    fetchMock.mockResolvedValueOnce(ok({ total: 1, rows: [{ rid: "r1", channel: "email", contact: "a@example.com", sent_at: "2026-10-02T04:30:00Z", status: "Failed" }] }));
    const d = await liveCommLogsApi.detail(ID, { page: 1, pageSize: 10, filters: { status: "Failed" } });
    expect(d.rows[0]).toMatchObject({ to: "a@example.com", status: "Failed", template: "tpl_b", type: "Email" });
  });

  it("close is not available on live data (read-only slice)", async () => {
    await expect(liveCommLogsApi.close(ID)).rejects.toThrow(/not available/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("performance (live)", () => {
  it("summary maps the server numbers", async () => {
    fetchMock.mockResolvedValue(ok({ basis: { matched: 1, counted: 1, scheduled: 0, in_progress: 0 }, totals: { sent: 2, delivered: 1, read: 1, clicked: 1, failed: 1 },
      by_channel: [{ channel: "email", sent: 2, delivered: 1, read: 1, clicked: 1 }], by_day: [{ day: "2026-10-02", sent: 2, delivered: 1 }] }));
    const s = await livePerformanceApi.summary({ filters: { channel: "email", startDate: "2026-10-01..2026-10-31", sentBy: "x" } });
    expect(Object.fromEntries(calledUrl().searchParams)).toEqual({ channel: "email", from: "2026-10-01", to: "2026-10-31" });
    expect(s.totals.sent).toBe(2); expect(s.byChannel[0].channel).toBe("Email"); expect(s.trend).toHaveLength(1);
  });
});

describe("suppressions (live)", () => {
  it("list + counts", async () => {
    fetchMock.mockResolvedValueOnce(ok({ total: 1, rows: [{ id: "s1", contact: "a@example.com", channel: "Email", reason: "Bounce", source: "hard bounce", at: "2026-09-30T09:14:00Z" }] }));
    const p = await liveSuppressionsApi.list({ page: 1, pageSize: 10, filters: { channel: "Email", reason: "Bounce" } });
    expect(p.rows[0]).toMatchObject({ contact: "a@example.com", reason: "Bounce", addedOn: "30/09/2026, 02:44 pm" });
    fetchMock.mockResolvedValueOnce(ok({ Unsubscribe: 3, Bounce: 1, Block: 0, Spam: 0, Invalid: 0 }));
    expect(await liveSuppressionsApi.counts("Email", "a", "2026-09-01..2026-09-30")).toEqual({ Unsubscribe: 3, Bounce: 1, Block: 0, Spam: 0, Invalid: 0 });
    expect(Object.fromEntries(calledUrl(1).searchParams)).toEqual({ channel: "Email", search: "a", from: "2026-09-01", to: "2026-09-30" });
  });
  it("add / remove are not available on live data (read-only slice)", async () => {
    // setup for this test only: LIVE_WRITES.suppressions forced OFF (same way as live-suppressions.test.ts), restored when the test ends
    vi.resetModules();
    vi.doMock("./live-config", async (orig) => ({ ...(await orig<typeof import("./live-config")>()), LIVE_WRITES: { suppressions: false } }));
    onTestFinished(() => { vi.doUnmock("./live-config"); vi.resetModules(); });
    const { liveSuppressionsApi } = await import("./live-api");
    await expect(liveSuppressionsApi.add("Email", ["a@example.com"], "Block")).rejects.toThrow(/not available/i);
    await expect(liveSuppressionsApi.remove(["s1"])).rejects.toThrow(/not available/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("failure paths → clear messages for the screens' error states", () => {
  it.each([
    [401, "NOT_LOGGED_IN", /log in again/i],
    [403, "FORBIDDEN", /do not have access/i],
    [429, "RATE_LIMITED", /too many requests/i],
    [400, "RANGE_TOO_LONG", /90 days or less/i],
    [400, "INVALID", /filters are not valid/i],
    [404, "NOT_FOUND", /not found/i],
    [500, "SERVER", /could not load/i],
    [503, "UNAVAILABLE", /could not load/i],
  ])("%i %s", async (status, code, msg) => {
    fetchMock.mockResolvedValue(fail(status, code));
    await expect(liveCommLogsApi.list({ page: 1, pageSize: 10 })).rejects.toThrow(msg);
  });
  it("network error / non-JSON answer", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(liveSuppressionsApi.list({ page: 1, pageSize: 10, filters: { channel: "Email" } })).rejects.toThrow(/could not load/i);
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => { throw new Error("bad json"); } });
    await expect(livePerformanceApi.summary({})).rejects.toThrow(/could not load/i);
  });
});
