import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGoogleAccount, GoogleError } from "./account";

type Call = { url: string; method: string; body: unknown; headers: Record<string, string> };

/** A fake Google: answers each call from a queue, records what was sent. */
function fakeFetch(answers: { status: number; body?: unknown }[]) {
  const calls: Call[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input), method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const a = answers.shift() ?? { status: 500, body: { error: "no answer queued" } };
    return new Response(a.status === 204 ? null : JSON.stringify(a.body ?? {}), { status: a.status });
  }) as typeof fetch;
  return { fn, calls };
}

const ENV = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REFRESH_TOKEN", "ORGANIZER_EMAIL", "INVITE_MODE", "TEST_EMAILS"].map((k) => `ZZT_${k}`);
beforeEach(() => { for (const k of ENV) delete process.env[k]; });
afterEach(() => { for (const k of ENV) delete process.env[k]; });

const ev = { id: "viabcg0", status: "confirmed", hangoutLink: "https://meet.google.com/abc-defg-hij", conferenceData: { conferenceId: "abc-defg-hij" } };

describe("google account", () => {
  it("is configured only with all four auth values (prefix-scoped env)", () => {
    const g = createGoogleAccount("ZZT");
    expect(g.configured()).toBe(false);
    process.env.ZZT_GOOGLE_CLIENT_ID = "id"; process.env.ZZT_GOOGLE_CLIENT_SECRET = "s"; process.env.ZZT_GOOGLE_REFRESH_TOKEN = "r";
    expect(g.configured()).toBe(false);
    process.env.ZZT_ORGANIZER_EMAIL = "Admissions@Vedam.org";
    expect(g.configured()).toBe(true);
    expect(g.organizerEmail()).toBe("admissions@vedam.org");
  });

  it("test mode invites only listed emails; live invites anyone", () => {
    const g = createGoogleAccount("ZZT");
    expect(g.invitesAllowed(["a@x.com"])).toBe(false); // empty list allows nobody
    process.env.ZZT_TEST_EMAILS = " A@x.com, b@x.com ";
    expect(g.invitesAllowed(["a@x.com", "B@X.com"])).toBe(true);
    expect(g.invitesAllowed(["a@x.com", "stranger@x.com"])).toBe(false);
    expect(g.invitesAllowed([])).toBe(false);
    process.env.ZZT_INVITE_MODE = "live";
    expect(g.invitesAllowed(["stranger@x.com"])).toBe(true);
  });

  it("creates an event with its own Meet, private guest list, emails lower-cased once", async () => {
    const f = fakeFetch([{ status: 200, body: ev }]);
    const g = createGoogleAccount("ZZT", { fetch: f.fn, accessToken: async () => "tok" });
    const out = await g.createEvent({ id: "viabcg0", summary: "S", description: "D", start: "2026-11-25T05:30:00.000Z", end: "2026-11-25T06:00:00.000Z",
      attendees: ["Ravi@Example.com", "asha@vedam.org", "ravi@example.com"] });
    expect(out.hangoutLink).toBe(ev.hangoutLink);
    const c = f.calls[0];
    expect(c.method).toBe("POST");
    expect(c.url).toContain("conferenceDataVersion=1");
    expect(c.url).toContain("sendUpdates=all");
    expect(c.headers.Authorization).toBe("Bearer tok");
    expect(c.body).toMatchObject({
      id: "viabcg0", summary: "S", guestsCanSeeOtherGuests: false, guestsCanInviteOthers: false, guestsCanModify: false,
      attendees: [{ email: "ravi@example.com" }, { email: "asha@vedam.org" }],
      start: { dateTime: "2026-11-25T05:30:00.000Z", timeZone: "Asia/Kolkata" },
      conferenceData: { createRequest: { requestId: "viabcg0", conferenceSolutionKey: { type: "hangoutsMeet" } } },
    });
  });

  it("an id that already exists and is live (an earlier timed-out try) is reused", async () => {
    const f = fakeFetch([{ status: 409, body: {} }, { status: 200, body: ev }]);
    const g = createGoogleAccount("ZZT", { fetch: f.fn, accessToken: async () => "t" });
    const out = await g.createEvent({ id: "viabcg0", summary: "S", description: "D", start: "a", end: "b", attendees: ["a@x.com"] });
    expect(out.id).toBe("viabcg0");
    expect(f.calls.map((c) => c.method)).toEqual(["POST", "GET"]);
  });

  it("an id of a deleted event is refused (the caller moves to the next generation)", async () => {
    const f = fakeFetch([{ status: 409, body: {} }, { status: 200, body: { ...ev, status: "cancelled" } }]);
    const g = createGoogleAccount("ZZT", { fetch: f.fn, accessToken: async () => "t" });
    await expect(g.createEvent({ id: "viabcg0", summary: "S", description: "D", start: "a", end: "b", attendees: ["a@x.com"] }))
      .rejects.toMatchObject({ status: 409 });
  });

  it("refuses an event id Google would reject, before calling Google", async () => {
    const f = fakeFetch([]);
    const g = createGoogleAccount("ZZT", { fetch: f.fn, accessToken: async () => "t" });
    await expect(g.createEvent({ id: "BAD-ID", summary: "", description: "", start: "", end: "", attendees: [] })).rejects.toBeInstanceOf(GoogleError);
    expect(f.calls).toHaveLength(0);
  });

  it("moves an event in one PATCH (time + guests) and keeps the Meet", async () => {
    const f = fakeFetch([{ status: 200, body: ev }]);
    const g = createGoogleAccount("ZZT", { fetch: f.fn, accessToken: async () => "t" });
    await g.patchEvent("viabcg0", { start: "s", end: "e", attendees: ["X@y.com"] });
    expect(f.calls[0].method).toBe("PATCH");
    expect(f.calls[0].url).toContain("/viabcg0?conferenceDataVersion=1&sendUpdates=all");
    expect(f.calls[0].body).toEqual({ start: { dateTime: "s", timeZone: "Asia/Kolkata" }, end: { dateTime: "e", timeZone: "Asia/Kolkata" }, attendees: [{ email: "x@y.com" }] });
  });

  it("deleting an event that is already gone is fine; other errors are raised", async () => {
    const g1 = createGoogleAccount("ZZT", { fetch: fakeFetch([{ status: 410 }]).fn, accessToken: async () => "t" });
    await expect(g1.deleteEvent("viabcg0")).resolves.toBeUndefined();
    const g2 = createGoogleAccount("ZZT", { fetch: fakeFetch([{ status: 403, body: { error: "denied" } }]).fn, accessToken: async () => "t" });
    await expect(g2.deleteEvent("viabcg0")).rejects.toMatchObject({ status: 403 });
  });

  it("reads Meet records for a meeting code within a time window; refuses odd codes", async () => {
    const f = fakeFetch([{ status: 200, body: { conferenceRecords: [{ name: "conferenceRecords/1", startTime: "x" }] } }]);
    const g = createGoogleAccount("ZZT", { fetch: f.fn, accessToken: async () => "t" });
    const recs = await g.conferenceRecords("abc-defg-hij", new Date("2026-11-25T05:00:00Z"), new Date("2026-11-25T07:00:00Z"));
    expect(recs).toHaveLength(1);
    const filter = new URL(f.calls[0].url).searchParams.get("filter");
    expect(filter).toBe('space.meeting_code = "abc-defg-hij" AND start_time>="2026-11-25T05:00:00.000Z" AND start_time<="2026-11-25T07:00:00.000Z"');
    await expect(g.conferenceRecords('x" OR 1=1', new Date(), new Date())).rejects.toBeInstanceOf(GoogleError);
  });

  it("people in a Meet record: signed-in users by id, guests by name; someone still in counts until now", async () => {
    const f = fakeFetch([
      { status: 200, body: { participants: [
        { name: "conferenceRecords/1/participants/a", signedinUser: { user: "users/1" } },
        { name: "conferenceRecords/1/participants/b", anonymousUser: { displayName: "Ravi" } }] } },
      { status: 200, body: { participantSessions: [{ startTime: "2026-11-25T05:30:00Z", endTime: "2026-11-25T06:00:00Z" }] } },
      { status: 200, body: { participantSessions: [{ startTime: "2026-11-25T05:31:00Z" }] } },
    ]);
    const g = createGoogleAccount("ZZT", { fetch: f.fn, accessToken: async () => "t" });
    const now = Date.parse("2026-11-25T05:50:00Z");
    const ppl = await g.attendees({ name: "conferenceRecords/1" }, now);
    expect(ppl).toEqual([
      { key: "users/1", sessions: [{ start: Date.parse("2026-11-25T05:30:00Z"), end: Date.parse("2026-11-25T06:00:00Z") }] },
      { key: "guest:ravi", sessions: [{ start: Date.parse("2026-11-25T05:31:00Z"), end: now }] },
    ]);
  });
});
