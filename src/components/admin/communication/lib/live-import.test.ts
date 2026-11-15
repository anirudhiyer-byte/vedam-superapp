/** Slice 3b · client: import requests, static list mapping, live count. fetch is faked; fake data only. */
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { importApi, uploadView } from "./live-import";
import { listBuilderApi, toListRow } from "./live-lists";
import { STATIC_LIST_IMPORT, isLivePage, liveNote } from "./live-config";

const ID = "7b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";
const RES = { id: null, name: null, kind: "static", dry_run: true, rows: 3, invalid: 1, duplicate: 0, matched: 2, unmatched: 0, members: 2,
  with_phone: 2, with_email: 1, consented: 1, sample: [{ phone: "********01", email: null, consent: true }] };
const fetchMock = vi.fn();
const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ ok: true, data }) });
const fail = (status: number, code: string) => ({ ok: false, status, json: async () => ({ ok: false, code }) });
const call = (i = 0) => ({ url: String(fetchMock.mock.calls[i][0]), init: fetchMock.mock.calls[i][1] as RequestInit });

beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("flag", () => {
  it("STATIC_LIST_IMPORT is on (approved on staging): the Upload page is the live CSV → static list flow", () => {
    expect(STATIC_LIST_IMPORT).toBe(true);
    expect(isLivePage("upload")).toBe(true);
    expect(liveNote("lists")).toBe("counts and masked samples only, nothing is sent.");
  });
  it("flag forced OFF (this test only): import API is not available, no request is sent, Upload page is the old wizard", async () => {
    expect(uploadView()).toBe("static-import");   // the real default, before forcing it off
    vi.resetModules();
    vi.doMock("./live-config", async (orig) => ({ ...(await orig<typeof import("./live-config")>()), STATIC_LIST_IMPORT: false }));
    onTestFinished(() => { vi.doUnmock("./live-config"); vi.resetModules(); });
    const off = await import("./live-import");
    expect(off.uploadView()).toBe("old-wizard");
    await expect(off.importApi.preview([{ p: "9000000301" }])).rejects.toThrow("CSV import is not available.");
    await expect(off.importApi.create("ZZ", [{ p: "9000000301" }])).rejects.toThrow("CSV import is not available.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("importApi", () => {
  it("preview: one POST with dryRun true and only the p / e cells", async () => {
    fetchMock.mockResolvedValue(ok(RES));
    const r = await importApi.preview([{ p: "9000000301" }, { e: "zz@example.invalid" }, {}]);
    expect(call().url).toBe("/api/admin/comm/lists/import");
    expect(call().init).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect(JSON.parse(String(call().init.body))).toEqual({ dryRun: true, rows: [{ p: "9000000301" }, { e: "zz@example.invalid" }, {}] });
    expect(r).toMatchObject({ rows: 3, matched: 2, members: 2, withPhone: 2, withEmail: 1, consented: 1, invalid: 1 });
  });
  it("create: dryRun false with the trimmed name", async () => {
    fetchMock.mockResolvedValue(ok({ ...RES, id: ID, name: "ZZ fair", dry_run: false }));
    const r = await importApi.create("  ZZ fair  ", [{ p: "9000000301" }]);
    expect(JSON.parse(String(call().init.body))).toEqual({ dryRun: false, name: "ZZ fair", rows: [{ p: "9000000301" }] });
    expect(r.id).toBe(ID);
  });
  it.each([
    [400, "INVALID", /nobody in the file matched/],
    [403, "FORBIDDEN", /only admins/i],
    [429, "RATE_LIMITED", /too many requests/i],
    [500, "SERVER", /could not save/i],
  ])("failure %i %s → clear message", async (status, code, msg) => {
    fetchMock.mockResolvedValue(fail(status, code));
    await expect(importApi.create("ZZ", [{ p: "9000000301" }])).rejects.toThrow(msg);
  });
});

describe("static lists in Manage List", () => {
  const LIST = { id: ID, name: "ZZ fair", kind: "static", conditions: {}, owner_is_me: true, created_at: "2026-11-05T06:00:00Z", updated_at: "2026-11-05T06:00:00Z" };
  it("kind static → origin 'Static list (CSV)' and the static flag; dynamic lists unchanged", () => {
    expect(toListRow(LIST)).toMatchObject({ origin: "Static list (CSV)", static: true, live: true, totalLeads: null });
    const dyn = toListRow({ ...LIST, kind: "dynamic" });
    expect(dyn.origin).toBe("Saved filter (VSAT)");
    expect("static" in dyn).toBe(false);
  });
  it("count: GET /lists/{id}/count, mapped like the preview", async () => {
    fetchMock.mockResolvedValue(ok({ kind: "static", total: 2, with_phone: 2, with_email: 1, consented: 1, sample: [] }));
    expect(await listBuilderApi.count(ID)).toEqual({ total: 2, withPhone: 2, withEmail: 1, consented: 1, sample: [] });
    expect(call().url).toBe(`/api/admin/comm/lists/${ID}/count`);
  });
});
