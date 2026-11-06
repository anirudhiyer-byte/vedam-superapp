/** Slice 4 · client: flag default (on) and forced off, requests when on, row mapping, reason messages. fetch is faked; fake data only. */
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { DOC_MESSAGES, docTemplatesView, fmtSize, toDocRow } from "./live-doc-templates";
import { DOC_TEMPLATES_LIVE, isLivePage, liveNote } from "./live-config";

const ID = "7b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d";
const ROW = { id: ID, name: "ZZ offer", merge_fields: ["full_name"], size: 2048, owner_is_me: true, created_at: "2026-11-06T06:30:00Z", updated_at: "2026-11-06T07:00:00Z" };
const fetchMock = vi.fn();
const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ ok: true, data }) });
const fail = (status: number, code: string, reason?: string) => ({ ok: false, status, json: async () => ({ ok: false, code, ...(reason ? { reason } : {}) }) });
const call = (i = 0) => ({ url: String(fetchMock.mock.calls[i][0]), init: fetchMock.mock.calls[i][1] as RequestInit });

/** the client with the flag forced ON (only inside the test that asks for it) */
async function liveOn() {
  vi.resetModules();
  vi.doMock("./live-config", async (orig) => ({ ...(await orig<typeof import("./live-config")>()), DOC_TEMPLATES_LIVE: true }));
  return import("./live-doc-templates");
}

beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); vi.doUnmock("./live-config"); vi.resetModules(); });

describe("flag", () => {
  it("DOC_TEMPLATES_LIVE is on (approved on staging): the Manage Document Templates page is the live page", () => {
    expect(DOC_TEMPLATES_LIVE).toBe(true);
    expect(isLivePage("docTemplates")).toBe(true);
    expect(docTemplatesView()).toBe("live");
  });
  it("flag forced OFF (this test only): the page stays the old sample page, no request is ever sent", async () => {
    vi.resetModules();
    vi.doMock("./live-config", async (orig) => ({ ...(await orig<typeof import("./live-config")>()), DOC_TEMPLATES_LIVE: false }));
    onTestFinished(() => { vi.doUnmock("./live-config"); vi.resetModules(); });
    const off = await import("./live-doc-templates");
    expect(off.docTemplatesView()).toBe("mock");
    await expect(off.docTemplatesApi.list({ page: 1, pageSize: 10 })).rejects.toThrow("Document templates are not available on live data yet.");
    await expect(off.docTemplatesApi.check("<p>x</p>")).rejects.toThrow("not available");
    await expect(off.docTemplatesApi.create("ZZ", "<p>x</p>")).rejects.toThrow("not available");
    await expect(off.docTemplatesApi.update(ID, { name: "ZZ" })).rejects.toThrow("not available");
    await expect(off.docTemplatesApi.remove(ID)).rejects.toThrow("not available");
    await expect(off.docTemplatesApi.get(ID)).rejects.toThrow("not available");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("other pages are unchanged by the new flag", () => {
    expect(liveNote("lists")).toBe("counts and masked samples only, nothing is sent.");
    expect(isLivePage("lists")).toBe(true);
  });
});

describe("requests (flag forced ON in these tests only)", () => {
  it("list: GET with page / size / trimmed search, rows mapped", async () => {
    const live = await liveOn();
    expect(live.docTemplatesView()).toBe("live");
    fetchMock.mockResolvedValue(ok({ total: 1, rows: [ROW] }));
    const p = await live.docTemplatesApi.list({ page: 2, pageSize: 25, search: "  ZZ  " });
    expect(call().url).toBe("/api/admin/comm/doc-templates?page=2&size=25&search=ZZ");
    expect(p.total).toBe(1);
    expect(p.rows[0]).toMatchObject({ id: ID, name: "ZZ offer", mergeFields: ["full_name"], size: 2048, owner: "You" });
  });
  it("check: POST to /check with the raw HTML (the server cleans it), name only when given", async () => {
    const live = await liveOn();
    fetchMock.mockResolvedValue(ok({ dry_run: true, merge_fields: ["full_name"], size: 25, html: "<p>x</p>", removed: { tags: 1, attributes: 0, handlers: 0, styles: 0, comments: 0, byTag: { script: 1 } } }));
    const r = await live.docTemplatesApi.check("<p>x</p><script>1</script>");
    expect(call().url).toBe("/api/admin/comm/doc-templates/check");
    expect(call().init.method).toBe("POST");
    expect(JSON.parse(String(call().init.body))).toEqual({ html: "<p>x</p><script>1</script>" });
    expect(r).toEqual({ html: "<p>x</p>", mergeFields: ["full_name"], size: 25, removed: { tags: 1, attributes: 0, handlers: 0, styles: 0, comments: 0, byTag: { script: 1 } } });
    await live.docTemplatesApi.check("<p>x</p>", "  ZZ  ");
    expect(JSON.parse(String(call(1).init.body))).toEqual({ name: "ZZ", html: "<p>x</p>" });
  });
  it("create / update / delete hit the right URLs with only name / html", async () => {
    const live = await liveOn();
    fetchMock.mockResolvedValue(ok(ROW));
    await live.docTemplatesApi.create("  ZZ offer ", "<p>a</p>");
    expect([call(0).url, call(0).init.method, JSON.parse(String(call(0).init.body))]).toEqual(["/api/admin/comm/doc-templates", "POST", { name: "ZZ offer", html: "<p>a</p>" }]);
    await live.docTemplatesApi.update(ID, { name: " ZZ v2 " });
    expect([call(1).url, call(1).init.method, JSON.parse(String(call(1).init.body))]).toEqual([`/api/admin/comm/doc-templates/${ID}`, "PATCH", { name: "ZZ v2" }]);
    await live.docTemplatesApi.update(ID, { html: "<p>b</p>" });
    expect(JSON.parse(String(call(2).init.body))).toEqual({ html: "<p>b</p>" });
    fetchMock.mockResolvedValue(ok({ id: ID, deleted: true }));
    await live.docTemplatesApi.remove(ID);
    expect([call(3).url, call(3).init.method, call(3).init.body]).toEqual([`/api/admin/comm/doc-templates/${ID}`, "DELETE", undefined]);
  });
  it("ids are URL-encoded (a changed id cannot reach another route)", async () => {
    const live = await liveOn();
    fetchMock.mockResolvedValue(ok(ROW));
    await live.docTemplatesApi.get("../check");
    expect(call().url).toBe("/api/admin/comm/doc-templates/..%2Fcheck");
  });
  it.each([
    ["unknown_merge_field", "Only these merge fields can be used"], ["too_big", "under 100 KB"], ["empty", "Nothing is left after cleaning"], ["unsafe_text", "javascript:"],
  ])("server reason %s → clear message", async (reason, text) => {
    const live = await liveOn();
    fetchMock.mockResolvedValue(fail(400, "INVALID", reason));
    await expect(live.docTemplatesApi.check("<p>x</p>")).rejects.toThrow(text);
  });
  it("status codes without a reason → their message; unknown → generic", async () => {
    const live = await liveOn();
    fetchMock.mockResolvedValueOnce(fail(404, "NOT_FOUND"));
    await expect(live.docTemplatesApi.update(ID, { name: "ZZ" })).rejects.toThrow(DOC_MESSAGES.NOT_FOUND);
    fetchMock.mockResolvedValueOnce(fail(400, "INVALID", "something_new"));
    await expect(live.docTemplatesApi.create("ZZ", "<p>x</p>")).rejects.toThrow(DOC_MESSAGES.INVALID);
  });
});

describe("helpers", () => {
  it("row mapping: another admin's template, bad dates become '-'", () => {
    expect(toDocRow({ ...ROW, owner_is_me: false, created_at: "nope" })).toMatchObject({ owner: "Another admin", createdOn: "-" });
  });
  it("size text", () => {
    expect(fmtSize(830)).toBe("830 B");
    expect(fmtSize(12_700)).toBe("12.4 KB");
  });
});
