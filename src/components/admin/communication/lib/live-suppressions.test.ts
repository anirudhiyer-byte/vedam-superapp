/**
 * Live Suppressions Add / Remove (Slice 2): client side. fetch is faked; fake data only.
 * Flag OFF behaviour ("not available on live data yet") is covered in live-api.test.ts and must not change.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidEmail, isValidMobile, phone91, reasonIssue } from "./live-suppressions";

const ID = "6a2f0c8e-1b3d-4e5f-8a9b-0c1d2e3f4a5b";
const fetchMock = vi.fn();
const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ ok: true, data }) });
const fail = (status: number, code: string) => ({ ok: false, status, json: async () => ({ ok: false, code }) });
const call = (i = 0) => ({ url: String(fetchMock.mock.calls[i][0]), init: fetchMock.mock.calls[i][1] as RequestInit });

/** load live-api with LIVE_WRITES.suppressions forced to the given value */
async function loadLive(on: boolean) {
  vi.resetModules();
  vi.doMock("./live-config", async (orig) => ({ ...(await orig<typeof import("./live-config")>()), LIVE_WRITES: { suppressions: on } }));
  return (await import("./live-api")).liveSuppressionsApi;
}

beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); vi.doUnmock("./live-config"); });

describe("checks (pure, same rules as the API and the database)", () => {
  it("phone91 / mobile / e-mail", () => {
    expect(phone91("+91 90000 00301")).toBe("919000000301");
    expect(phone91("5000000301")).toBeNull();
    expect(isValidMobile("+91 (900) 000-0301")).toBe(true);
    expect(isValidMobile("98abc76543")).toBe(false);
    expect(isValidEmail(" ZZ@Example.INVALID ")).toBe(true);
    expect(isValidEmail("zz@example")).toBe(false);
  });
  it("reason: 10–200 characters after trimming, one line", () => {
    expect(reasonIssue("ZZ added by mistake")).toBeNull();
    expect(reasonIssue("  short   ")).toMatch(/at least 10/);
    expect(reasonIssue("r".repeat(201))).toMatch(/200/);
    expect(reasonIssue("ZZ added by\nmistake")).toMatch(/one line/);
  });
});

describe("flag OFF: unchanged", () => {
  it("add / remove say 'not available on live data yet' and never call the server", async () => {
    const api = await loadLive(false);
    await expect(api.add("Email", ["zz@example.invalid"], "Block", "note")).rejects.toThrow(/not available/i);
    await expect(api.remove([ID], "ZZ added by mistake")).rejects.toThrow(/not available/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("flag ON", () => {
  it("add: one POST to /suppressions/manual with channel, contact, category and the trimmed note", async () => {
    const api = await loadLive(true);
    fetchMock.mockResolvedValue(ok({ id: ID, status: "added" }));
    expect(await api.add("Email", ["zz@example.invalid"], "Spam", "  ZZ note  ")).toEqual({ ok: true, added: 1, duplicates: 0 });
    expect(call().url).toBe("/api/admin/comm/suppressions/manual");
    expect(call().init).toMatchObject({ method: "POST", credentials: "same-origin" });
    expect(JSON.parse(String(call().init.body))).toEqual({ channel: "Email", contact: "zz@example.invalid", category: "Spam", note: "ZZ note" });
  });
  it("add: empty note is not sent; 'already' counts as a duplicate", async () => {
    const api = await loadLive(true);
    fetchMock.mockResolvedValue(ok({ id: ID, status: "already" }));
    expect(await api.add("WhatsApp", ["+91 90000 00301"], "Unsubscribe", "   ")).toEqual({ ok: true, added: 0, duplicates: 1 });
    expect(JSON.parse(String(call().init.body))).toEqual({ channel: "WhatsApp", contact: "+91 90000 00301", category: "Unsubscribe" });
  });
  it("add: more than one contact is refused before any request (no bulk)", async () => {
    const api = await loadLive(true);
    await expect(api.add("Email", ["zz-a@example.invalid", "zz-b@example.invalid"], "Block")).rejects.toThrow(/one contact at a time/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("remove: one DELETE with the trimmed reason in the body", async () => {
    const api = await loadLive(true);
    fetchMock.mockResolvedValue(ok({ id: ID, removed: true }));
    expect(await api.remove([ID], "  ZZ added by mistake  ")).toEqual({ ok: true, removed: 1 });
    expect(call().url).toBe(`/api/admin/comm/suppressions/manual/${ID}`);
    expect(call().init.method).toBe("DELETE");
    expect(JSON.parse(String(call().init.body))).toEqual({ reason: "ZZ added by mistake" });
  });
  it("remove: several ids, or a missing / short reason, are refused before any request", async () => {
    const api = await loadLive(true);
    await expect(api.remove([ID, ID], "ZZ added by mistake")).rejects.toThrow(/one entry at a time/i);
    await expect(api.remove([ID])).rejects.toThrow(/at least 10/i);
    await expect(api.remove([ID], "too short")).rejects.toThrow(/at least 10/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    [409, "LOCKED", /STOP reply, an unsubscribe link or a bounce/],
    [404, "NOT_FOUND", /no longer on the list/],
    [400, "INVALID", /reason of 10 to 200/],
    [403, "FORBIDDEN", /only admins/i],
    [429, "RATE_LIMITED", /too many requests/i],
    [500, "SERVER", /could not save/i],
  ])("remove failure %i %s → clear message", async (status, code, msg) => {
    const api = await loadLive(true);
    fetchMock.mockResolvedValue(fail(status, code));
    await expect(api.remove([ID], "ZZ added by mistake")).rejects.toThrow(msg);
  });
  it("add failure 400 → asks to check the contact; network error → connection message", async () => {
    const api = await loadLive(true);
    fetchMock.mockResolvedValueOnce(fail(400, "INVALID"));
    await expect(api.add("Email", ["zz@example.invalid"], "Block")).rejects.toThrow(/check the contact/i);
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(api.add("Email", ["zz@example.invalid"], "Block")).rejects.toThrow(/connection/i);
  });
});
