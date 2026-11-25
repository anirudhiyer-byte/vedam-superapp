import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GoogleError, type CalEvent, type EventInput, type GoogleAccount } from "@/lib/google/account";
import { checkInterviewAttendance, sendInterviewNotices, syncInterviews, syncOne, type NoticeConfig, type SyncRow } from "./interview-sync";
import type { NoticeJob } from "./interviews";
import { TRACKS } from "./tracks";

const ID = "11111111-1111-4111-8111-111111111111";
const LINK = "https://meet.google.com/abc-defg-hij";
const later = (min: number) => new Date(Date.now() + min * 60_000).toISOString();

function row(over: Partial<SyncRow> = {}): SyncRow {
  return {
    id: ID, version: 2, claimed_at: "2026-11-23T10:00:00.123456Z", attempts: 1, application_id: "APP-1",
    slot_start: later(60 * 24), duration_min: 30, meet_mode: "auto", cancelled: false,
    calendar_event_id: null, event_gen: 0, event_version: null,
    student: { name: "Ravi", email: "Ravi@Example.com", application_no: "V-1" },
    interviewer: { id: "int-1", name: "Asha", email: "asha@vedam.org" },
    ...over,
  };
}

/** A fake Google account: records every call; behaviour per method can be swapped. */
function fakeGoogle(over: Partial<GoogleAccount> = {}) {
  const calls: { fn: string; args: unknown[] }[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a recorder that wraps any method
  const rec = <F extends (...a: any[]) => Promise<unknown>>(fn: string, impl: F): F =>
    (async (...args: Parameters<F>) => { calls.push({ fn, args }); return impl(...args); }) as F;
  const made = (id: string): CalEvent => ({ id, status: "confirmed", hangoutLink: LINK, conferenceData: { conferenceId: "abc-defg-hij" } });
  const g: GoogleAccount = {
    configured: () => true,
    inviteModeLive: () => false,
    invitesAllowed: () => true,
    organizerEmail: () => "admissions@vedam.org",
    createEvent: rec("createEvent", async (e: EventInput) => made(e.id)) as GoogleAccount["createEvent"],
    getEvent: rec("getEvent", async (id: string) => made(id)) as GoogleAccount["getEvent"],
    patchEvent: rec("patchEvent", async (id: string) => made(id)) as GoogleAccount["patchEvent"],
    deleteEvent: rec("deleteEvent", async () => undefined) as GoogleAccount["deleteEvent"],
    conferenceRecords: rec("conferenceRecords", async () => []) as GoogleAccount["conferenceRecords"],
    attendees: rec("attendees", async () => []) as GoogleAccount["attendees"],
    ...over,
  };
  return { g, calls };
}

describe("syncOne — what happens on Google", () => {
  it("new interview → event under generation 0, with the Meet link and code", async () => {
    const { g, calls } = fakeGoogle();
    const r = await syncOne(g, row());
    expect(r).toMatchObject({ outcome: "ok", calendar_event_id: `vi${ID.replace(/-/g, "")}g0`, meet_link: LINK, meet_code: "abc-defg-hij", event_gen: 0 });
    const input = calls[0].args[0] as EventInput;
    expect(input.attendees).toEqual(["ravi@example.com", "asha@vedam.org"]);
    expect(input.summary).toBe("Vedam admissions interview: Ravi (V-1)");
  });
  it("Meet link not ready yet → pending (read again next run)", async () => {
    const { g } = fakeGoogle({ createEvent: (async (e: EventInput) => ({ id: e.id })) as GoogleAccount["createEvent"] });
    expect((await syncOne(g, row())).outcome).toBe("pending");
  });
  it("event already matches this version → only read, never re-sent to guests", async () => {
    const { g, calls } = fakeGoogle();
    const r = await syncOne(g, row({ calendar_event_id: "viold", event_version: 2 }));
    expect(r.outcome).toBe("ok");
    expect(calls.map((c) => c.fn)).toEqual(["getEvent"]);
  });
  it("moved → the same event is moved (keeps its Meet link)", async () => {
    const { g, calls } = fakeGoogle();
    const r = await syncOne(g, row({ calendar_event_id: "viold", event_version: 1 }));
    expect(calls.map((c) => c.fn)).toEqual(["getEvent", "patchEvent"]);
    expect(r).toMatchObject({ outcome: "ok", calendar_event_id: "viold" });
  });
  it("event deleted on Google's side → a new one under the next generation, the old id forgotten", async () => {
    const { g } = fakeGoogle({ getEvent: (async () => { throw new GoogleError(404, "gone"); }) as GoogleAccount["getEvent"] });
    const r = await syncOne(g, row({ calendar_event_id: "viold", event_gen: 0, event_version: 1 }));
    expect(r).toMatchObject({ outcome: "ok", deleted_event_id: "viold", event_gen: 1, calendar_event_id: `vi${ID.replace(/-/g, "")}g1` });
  });
  it("an id taken by a deleted event → tries the next generation", async () => {
    let n = 0;
    const { g } = fakeGoogle({ createEvent: (async (e: EventInput) => { if (n++ === 0) throw new GoogleError(409, "taken"); return { id: e.id, hangoutLink: LINK }; }) as GoogleAccount["createEvent"] });
    const r = await syncOne(g, row());
    expect(r.event_gen).toBe(1);
  });
  it("cancelled / own link → the Google event is deleted", async () => {
    const { g, calls } = fakeGoogle();
    expect(await syncOne(g, row({ cancelled: true, slot_start: null, interviewer: null, calendar_event_id: "viold" }))).toEqual({ outcome: "none", deleted_event_id: "viold" });
    expect(await syncOne(g, row({ meet_mode: "manual", calendar_event_id: null }))).toEqual({ outcome: "none" });
    expect(calls.map((c) => c.fn)).toEqual(["deleteEvent"]);
  });
  it("staging test mode: a stranger's email → no invite, stop retrying, say why", async () => {
    const { g, calls } = fakeGoogle({ invitesAllowed: () => false });
    const r = await syncOne(g, row());
    expect(r).toMatchObject({ outcome: "failed", final: true });
    expect(r.error).toMatch(/^test_mode/);
    expect(calls).toHaveLength(0);
  });
  it("missing email or a time already passed → stop retrying", async () => {
    const { g } = fakeGoogle();
    expect(await syncOne(g, row({ student: { name: "R", email: null, application_no: null } }))).toMatchObject({ outcome: "failed", final: true, error: "missing_email" });
    expect(await syncOne(g, row({ slot_start: later(-120) }))).toMatchObject({ outcome: "failed", final: true, error: "time_passed" });
  });
  it("Google errors → failed (retried), final on the 5th try", async () => {
    const boom = (async () => { throw new GoogleError(500, "500 backend"); }) as GoogleAccount["createEvent"];
    expect(await syncOne(fakeGoogle({ createEvent: boom }).g, row({ attempts: 2 }))).toMatchObject({ outcome: "failed", final: false, error: "500 backend" });
    expect(await syncOne(fakeGoogle({ createEvent: boom }).g, row({ attempts: 5 }))).toMatchObject({ outcome: "failed", final: true });
  });
});

/** A fake database that answers rpc() from a map and records the calls. */
function fakeDb(answers: Record<string, unknown>) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const db = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      const a = answers[fn];
      return { data: typeof a === "function" ? (a as (x: unknown) => unknown)(args) : a ?? null, error: null };
    },
  } as unknown as SupabaseClient;
  return { db, calls };
}

describe("syncOne — counselling on the counsellor's Zoom link (0184)", () => {
  const ZOOM = "https://us06web.zoom.us/j/11111111111?pwd=abc";
  const zrow = (over: Partial<SyncRow> = {}) => row({ meet_mode: "zoom", zoom_link: ZOOM, ...over });
  /** Google answers like for an event made without a Meet (no hangoutLink); every call is still recorded */
  function noMeetGoogle() {
    const f = fakeGoogle();
    f.g.createEvent = (async (e: EventInput) => { f.calls.push({ fn: "createEvent", args: [e] }); return { id: e.id, status: "confirmed" }; }) as GoogleAccount["createEvent"];
    f.g.patchEvent = (async (id: string, p: unknown) => { f.calls.push({ fn: "patchEvent", args: [id, p] }); return { id, status: "confirmed" }; }) as GoogleAccount["patchEvent"];
    return f;
  }
  it("new Zoom booking → an event with no Google Meet, the Zoom link as its place and in the text; done (nothing to wait for)", async () => {
    const { g, calls } = noMeetGoogle();
    const r = await syncOne(g, zrow(), Date.now(), TRACKS.counselling);
    expect(r).toMatchObject({ outcome: "ok", calendar_event_id: `vc${ID.replace(/-/g, "")}g0`, event_gen: 0 });
    expect(r.meet_link).toBeUndefined();
    expect(r.meet_code).toBeUndefined();
    const input = calls[0].args[0] as EventInput;
    expect(input.meet).toBe(false);
    expect(input.location).toBe(ZOOM);
    expect(input.description).toContain(`Join on Zoom: ${ZOOM}`);
    expect(input.description).not.toContain("Google Meet");
  });
  it("moved → the same event is moved, still done", async () => {
    const { g, calls } = noMeetGoogle();
    g.getEvent = (async (id: string) => { calls.push({ fn: "getEvent", args: [id] }); return { id, status: "confirmed" }; }) as GoogleAccount["getEvent"];
    const r = await syncOne(g, zrow({ calendar_event_id: "vcold", event_version: 1 }), Date.now(), TRACKS.counselling);
    expect(calls.map((c) => c.fn)).toEqual(["getEvent", "patchEvent"]);
    expect((calls[1].args[1] as { location?: string }).location).toBe(ZOOM);
    expect(r).toMatchObject({ outcome: "ok", calendar_event_id: "vcold" });
  });
  it("an old Google Meet event (booking moved to Zoom) → deleted, and a new one without Meet under the next generation", async () => {
    const { g, calls } = noMeetGoogle(); // getEvent still answers with the old Google Meet event
    const r = await syncOne(g, zrow({ calendar_event_id: "vcold", event_gen: 0, event_version: 1 }), Date.now(), TRACKS.counselling);
    expect(calls.map((c) => c.fn)).toEqual(["getEvent", "deleteEvent", "createEvent"]);
    expect(r).toMatchObject({ outcome: "ok", deleted_event_id: "vcold", event_gen: 1, calendar_event_id: `vc${ID.replace(/-/g, "")}g1` });
  });
  it("a Zoom booking without a usable link → no event (an old one is removed)", async () => {
    const { g, calls } = fakeGoogle();
    const r = await syncOne(g, zrow({ zoom_link: "http://not-https.example/x", calendar_event_id: "vcold" }), Date.now(), TRACKS.counselling);
    expect(calls.map((c) => c.fn)).toEqual(["deleteEvent"]);
    expect(r).toMatchObject({ outcome: "none", deleted_event_id: "vcold" });
  });
});

describe("syncInterviews — claim, work, release", () => {
  it("does nothing until the admissions Google account is set up", async () => {
    const { db, calls } = fakeDb({});
    const r = await syncInterviews(db, {}, fakeGoogle({ configured: () => false }).g);
    expect(r.skipped).toBe("google_not_configured");
    expect(calls).toHaveLength(0);
  });
  it("hands the claim token and version back with the result", async () => {
    const { db, calls } = fakeDb({ vsat_interview_sync_claim: [row()], vsat_interview_sync_release: { applied: true } });
    const r = await syncInterviews(db, { ids: ["APP-1"] }, fakeGoogle().g);
    expect(r).toMatchObject({ claimed: 1, ok: 1, failed: 0 });
    expect(calls[0]).toEqual({ fn: "vsat_interview_sync_claim", args: { p: { limit: 20, application_ids: ["APP-1"] } } });
    const p = calls[1].args.p as Record<string, unknown>;
    expect(p).toMatchObject({ id: ID, version: 2, claimed_at: "2026-11-23T10:00:00.123456Z", outcome: "ok", meet_link: LINK });
    expect(Object.values(p)).not.toContain(undefined);
  });
});

describe("checkInterviewAttendance — Meet → result", () => {
  const due = { id: ID, version: 3, application_id: "APP-1", slot_datetime: "2026-11-23T05:30:00Z", duration_min: 30, meet_code: "abc-defg-hij", attendance_check_attempts: 0 };
  const now = Date.parse("2026-11-23T06:20:00Z");
  const rec = { name: "conferenceRecords/1", startTime: "2026-11-23T05:29:00Z", endTime: "2026-11-23T06:01:00Z" };
  it("only one person joined → no-show", async () => {
    const { db, calls } = fakeDb({ vsat_interview_attendance_due: [due], vsat_interview_attendance_apply: { applied: true } });
    const { g } = fakeGoogle({
      conferenceRecords: (async () => [rec]) as GoogleAccount["conferenceRecords"],
      attendees: (async () => [{ key: "users/1", sessions: [{ start: Date.parse("2026-11-23T05:30:00Z"), end: Date.parse("2026-11-23T06:00:00Z") }] }]) as GoogleAccount["attendees"],
    });
    const r = await checkInterviewAttendance(db, 20, g, now);
    expect(r.no_show).toBe(1);
    expect(calls[1].args.p).toMatchObject({ id: ID, version: 3, result: "no_show", detail: { people: 1, reason: "one_joined", records: 1 } });
  });
  it("both together for the interview → joined", async () => {
    const both = [Date.parse("2026-11-23T05:30:00Z"), Date.parse("2026-11-23T06:00:00Z")];
    const { db, calls } = fakeDb({ vsat_interview_attendance_due: [due], vsat_interview_attendance_apply: { applied: true } });
    const { g } = fakeGoogle({
      conferenceRecords: (async () => [rec]) as GoogleAccount["conferenceRecords"],
      attendees: (async () => [{ key: "users/1", sessions: [{ start: both[0], end: both[1] }] }, { key: "guest:ravi", sessions: [{ start: both[0] + 60_000, end: both[1] }] }]) as GoogleAccount["attendees"],
    });
    expect((await checkInterviewAttendance(db, 20, g, now)).done).toBe(1);
    expect(calls[1].args.p).toMatchObject({ result: "done" });
  });
  it("no Meet record yet → try again later (not marked)", async () => {
    const { db, calls } = fakeDb({ vsat_interview_attendance_due: [due], vsat_interview_attendance_apply: { applied: true } });
    expect((await checkInterviewAttendance(db, 20, fakeGoogle().g, now)).retry).toBe(1);
    expect(calls[1].args.p).toEqual({ id: ID, version: 3, result: "retry" });
  });
  it("Google keeps failing on the last try → left for an admin to mark", async () => {
    const { db, calls } = fakeDb({ vsat_interview_attendance_due: [{ ...due, attendance_check_attempts: 11 }], vsat_interview_attendance_apply: { applied: true } });
    const { g } = fakeGoogle({ conferenceRecords: (async () => { throw new GoogleError(500, "x"); }) as GoogleAccount["conferenceRecords"] });
    expect((await checkInterviewAttendance(db, 20, g, now)).marking).toBe(1);
    expect(calls[1].args.p).toMatchObject({ result: "needs_marking", detail: { reason: "check_failed" } });
  });
});

describe("sendInterviewNotices — VSAT comms steps", () => {
  const job: NoticeJob = {
    id: "ev-1", kind: "scheduled", version: 1, attempts: 1, sent_to: [],
    slot_start: "2026-11-25T05:30:00Z", duration_min: 30, prev_slot_start: null, prev_duration_min: null,
    interviewer: { id: "int-1", name: "Asha", email: "asha@vedam.org" }, baseline: null,
    student: { name: "Ravi <b>K</b>", email: "ravi@example.com", application_no: "V-1", lead_id: "lead-1" },
    meet_link: LINK, meet_mode: "auto",
  };
  const step = (k: string, over = {}) => [k, { step_key: k, title: k, enabled: true, test_mode: false, email_enabled: true,
    email_subject: "Interview {{date}}", email_body: "<p>Hi {{name}}, {{student_name}} {{join_link}}</p>", ...over }] as const;
  const cfg = (over: Partial<NoticeConfig> = {}): NoticeConfig => ({
    master: true, testEmail: "qa@vedam.org",
    steps: new Map([step("interview_invite"), step("interviewer_invite")]), ...over,
  });

  it("sends the planned emails and records who got them", async () => {
    const sent: Record<string, unknown>[] = [];
    const { db, calls } = fakeDb({ vsat_interview_notices_claim: [job], vsat_interview_notice_done: { updated: true } });
    const r = await sendInterviewNotices(db, { waitForMeet: false }, { config: cfg(), deliver: async (o) => { sent.push(o); return { ok: true }; } });
    expect(r).toMatchObject({ jobs: 1, sent: 2, failed: 0 });
    expect(sent.map((s) => s.to)).toEqual(["ravi@example.com", "asha@vedam.org"]);
    expect(sent[0]).toMatchObject({ kind: "vsat_interview_invite", userId: "lead-1", refId: "ev-1" });
    expect(String(sent[0].html)).toContain("Ravi &lt;b&gt;K&lt;/b&gt;");
    expect(String(sent[0].html)).toContain(LINK);
    expect(calls.at(-1)).toEqual({ fn: "vsat_interview_notice_done", args: { p: { id: "ev-1", status: "sent", detail: { sent_to: ["student", "interviewer:int-1"], sent_now: 2 } } } });
  });
  it("master switch off → nothing sent, job skipped", async () => {
    const { db, calls } = fakeDb({ vsat_interview_notices_claim: [job], vsat_interview_notice_done: { updated: true } });
    let n = 0;
    const r = await sendInterviewNotices(db, {}, { config: cfg({ master: false }), deliver: async () => { n++; return { ok: true }; } });
    expect(n).toBe(0);
    expect(r.off).toBe(2);
    expect((calls.at(-1)!.args.p as { status: string }).status).toBe("skipped");
  });
  it("test mode → goes to the comms test address, not the student", async () => {
    const sent: Record<string, unknown>[] = [];
    const { db } = fakeDb({ vsat_interview_notices_claim: [job], vsat_interview_notice_done: { updated: true } });
    await sendInterviewNotices(db, {}, {
      config: cfg({ steps: new Map([step("interview_invite", { test_mode: true })]) }),
      deliver: async (o) => { sent.push(o); return { ok: true }; },
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "qa@vedam.org", userId: null });
  });
  it("one email failing → job failed (retried) but remembers the one that went", async () => {
    const { db, calls } = fakeDb({ vsat_interview_notices_claim: [job], vsat_interview_notice_done: { updated: true } });
    await sendInterviewNotices(db, {}, { config: cfg(), deliver: async (o) => ({ ok: o.to === "ravi@example.com", error: "smtp" }) });
    expect(calls.at(-1)!.args.p).toEqual({ id: "ev-1", status: "failed", detail: { sent_to: ["student"], sent_now: 1 } });
  });
});
