/**
 * Live Manage List client (Slice 3a): fetch faked. Request shapes, mapping to ListRow,
 * the condition builder, and failure messages.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildConditions, emptyListForm, formFromConditions, listBuilderApi, liveListsApi, stageLabel, toListRow, type ListForm } from "./live-lists";

const ID = "5011eb15-74e9-4f7b-8b5d-192ff8f14aef";
const LIST = { id: ID, name: "Paid applicants", kind: "dynamic", conditions: { payment: "paid" }, owner_is_me: true, created_at: "2026-09-30T12:04:00Z", updated_at: "2026-09-30T12:04:00Z" };

const fetchMock = vi.fn();
const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ ok: true, data }) });
const fail = (status: number, code: string) => ({ ok: false, status, json: async () => ({ ok: false, code }) });
const call = (i = 0) => ({ url: new URL(String(fetchMock.mock.calls[i][0]), "https://x.example"), init: fetchMock.mock.calls[i][1] as RequestInit });

beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("mapping + condition builder (pure)", () => {
  it("list row: counts are 'View Count' (null), owner shown as You / Another admin, no tags", () => {
    expect(toListRow(LIST)).toMatchObject({ id: ID, name: "Paid applicants", origin: "Saved filter (VSAT)", totalLeads: null, uniqueEmail: null,
      uniqueMobile: null, createdOn: "30/09/2026 05:34 pm", createdBy: "You", owner: "You", tagged: false, live: true, conditions: { payment: "paid" } });
    expect(toListRow({ ...LIST, owner_is_me: false }).owner).toBe("Another admin");
  });
  it("buildConditions drops empty filters and keeps the rest typed", () => {
    expect(buildConditions(emptyListForm())).toEqual({});
    const f: ListForm = { ...emptyListForm(), lead_stage: ["applicant_paid"], grad_year: ["2026", "2027"], signup: "2026-10-01..2026-10-31",
      vsat_registered: "yes", exam_given: "no", payment: "started_not_paid", consent_given: "", state: [] };
    expect(buildConditions(f)).toEqual({ lead_stage: ["applicant_paid"], grad_year: [2026, 2027], signup: { from: "2026-10-01", to: "2026-10-31" },
      vsat_registered: true, exam_given: false, payment: "started_not_paid" });
  });
  it("edge: half-filled date range is not sent; formFromConditions round-trips", () => {
    expect(buildConditions({ ...emptyListForm(), signup: "2026-10-01.." })).toEqual({});
    const c = { city: ["Pune"], grad_year: [2026], signup: { from: "2026-10-01", to: "2026-10-02" }, consent_given: true, payment: "paid" as const };
    expect(buildConditions(formFromConditions(c))).toEqual(c);
  });
  it("stage labels are readable", () => {
    expect(stageLabel("applicant_unpaid")).toBe("Applicant unpaid");
    expect(stageLabel("vsat_not_cleared")).toBe("VSAT not cleared");
  });
});

describe("live lists API", () => {
  it("list: GET with search/page/size; returns ListRow page", async () => {
    fetchMock.mockResolvedValue(ok({ total: 1, rows: [LIST] }));
    const p = await liveListsApi.list({ search: " paid ", page: 1, pageSize: 10, filters: { form: "x" } });
    expect(call().url.pathname).toBe("/api/admin/comm/lists");
    expect(Object.fromEntries(call().url.searchParams)).toEqual({ search: "paid", page: "1", size: "10" });
    expect(p.total).toBe(1);
    expect(p.rows[0].name).toBe("Paid applicants");
  });
  it("create / update / preview / options send the right requests", async () => {
    fetchMock.mockResolvedValue(ok(LIST));
    await listBuilderApi.create("  Paid  ", { payment: "paid" });
    expect(call(0).init).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect(JSON.parse(String(call(0).init.body))).toEqual({ name: "Paid", conditions: { payment: "paid" } });
    await listBuilderApi.update(ID, { conditions: { consent_given: true } });
    expect(call(1).init.method).toBe("PATCH");
    expect(call(1).url.pathname).toBe(`/api/admin/comm/lists/${ID}`);
    expect(JSON.parse(String(call(1).init.body))).toEqual({ conditions: { consent_given: true } });
    fetchMock.mockResolvedValueOnce(ok({ total: 3, with_phone: 2, with_email: 1, consented: 1, sample: [{ phone: "********01", email: null, consent: true }] }));
    expect(await listBuilderApi.preview({})).toEqual({ total: 3, withPhone: 2, withEmail: 1, consented: 1, sample: [{ phone: "********01", email: null, consent: true }] });
    expect(call(2).url.pathname).toBe("/api/admin/comm/lists/preview");
    fetchMock.mockResolvedValueOnce(ok({ lead_stage: ["lead", "applicant_paid"], application_stage: [], lead_source: [], utm_source: ["google"], utm_campaign: [],
      campus: [], state: [], city: [], grad_year: [2026] }));
    const o = await listBuilderApi.filterOptions();
    expect(o.lead_stage).toEqual([{ value: "lead", label: "Lead" }, { value: "applicant_paid", label: "Applicant paid" }]);
    expect(o.grad_year).toEqual([{ value: "2026", label: "2026" }]);
  });
  it("rename through the old Edit page: name saved; a description is refused (not stored for live lists)", async () => {
    fetchMock.mockResolvedValue(ok(LIST));
    await liveListsApi.update(ID, { name: "New", description: "" });
    expect(JSON.parse(String(call(0).init.body))).toEqual({ name: "New" });
    await expect(liveListsApi.update(ID, { name: "New", description: "notes" })).rejects.toThrow(/description/i);
  });
  it("delete: one DELETE per list, at most 20 at a time", async () => {
    fetchMock.mockResolvedValue(ok({ id: ID, deleted: true }));
    expect(await liveListsApi.remove([ID, ID])).toEqual({ ok: true, removed: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(call(0).init.method).toBe("DELETE");
    await expect(liveListsApi.remove(Array.from({ length: 21 }, () => ID))).rejects.toThrow(/20/);
  });
  it("sending, owner change and tags are not available on live lists", async () => {
    await expect(liveListsApi.communicate({ listIds: [ID], channel: "email", template: "t", sender: "s", when: "now" })).rejects.toThrow(/not available/i);
    await expect(liveListsApi.communicateOptions()).rejects.toThrow(/not available/i);
    await expect(liveListsApi.changeOwner([ID], "x")).rejects.toThrow(/not available/i);
    await expect(liveListsApi.setTags(ID, ["a"])).rejects.toThrow(/not available/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("failure paths", () => {
  it.each([
    [404, "NOT_FOUND", /list was not found/i],
    [400, "INVALID", /not valid/i],
    [403, "FORBIDDEN", /do not have access/i],
    [429, "RATE_LIMITED", /too many requests/i],
    [500, "SERVER", /could not save/i],
  ])("write %i %s", async (status, code, msg) => {
    fetchMock.mockResolvedValue(fail(status, code));
    await expect(listBuilderApi.update(ID, { name: "x" })).rejects.toThrow(msg);
  });
  it("network error on save", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(listBuilderApi.create("A", {})).rejects.toThrow(/connection/i);
  });
});
