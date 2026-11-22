import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { GoogleAccount, EventInput, CalEvent } from "@/lib/google/account";
import { MEETING_STEP_KEYS, TRACKS, inTrackWords, withHost } from "./tracks";
import {
  counsellingCardCopy, eventText, interviewCardCopy, interviewEventId, isCounsellingStep, planNotices, type NoticeJob,
} from "./interviews";
import { toPlanRow } from "./interview-plan";
import { checkInterviewAttendance, sendInterviewNotices, syncInterviews, type NoticeConfig } from "./interview-sync";

const CS = TRACKS.counselling;
const IV = TRACKS.interview;

describe("tracks", () => {
  it("interview and counselling differ only in names", () => {
    expect(Object.keys(CS.rpc).sort()).toEqual(Object.keys(IV.rpc).sort());
    for (const [k, v] of Object.entries(CS.rpc)) {
      expect(v).not.toBe(IV.rpc[k as keyof typeof IV.rpc]);
      expect(v).toMatch(/counsel/);
    }
    expect(MEETING_STEP_KEYS).toHaveLength(12);
    expect(new Set(MEETING_STEP_KEYS).size).toBe(12);
  });
  it("Google event ids stay inside the allowed letters (a–v, 0–9)", () => {
    for (const t of [IV, CS]) expect(interviewEventId("11111111-1111-4111-8111-11111111ABCD", 3, t.eventPrefix)).toMatch(/^[a-v0-9]+$/);
    expect(interviewEventId("ab-cd", 0, "vc")).toBe("vcabcdg0");
    expect(interviewEventId("ab-cd", 0)).toBe("viabcdg0");
  });
  it("withHost: the counsellor becomes the shared 'interviewer' field (also in the baseline)", () => {
    const row = { id: "1", counsellor: { id: "c1" }, baseline: { kind: "scheduled", counsellor: { id: "c0" } } };
    const out = withHost(row, CS) as unknown as { interviewer: { id: string }; baseline: { interviewer: { id: string } } };
    expect(out.interviewer).toEqual({ id: "c1" });
    expect(out.baseline.interviewer).toEqual({ id: "c0" });
    expect(withHost(row, IV)).toBe(row);
    expect((withHost({ id: "2" }, CS) as Record<string, unknown>).interviewer).toBeNull();
  });
  it("shared messages read right on the counselling track, unchanged on the interview track", () => {
    expect(inTrackWords("The interviewer has another student at this time.", CS)).toBe("The counsellor has another student at this time.");
    expect(inTrackWords("Did the interview happen? Interviewers", CS)).toBe("Did the counselling session happen? Counsellors");
    expect(inTrackWords("The interviewer has another student at this time.", IV)).toBe("The interviewer has another student at this time.");
  });
});

describe("counselling emails and invite", () => {
  const job: NoticeJob = {
    id: "ev-1", kind: "scheduled", version: 1, attempts: 1, sent_to: [], slot_start: "2026-11-25T05:30:00Z", duration_min: 30,
    prev_slot_start: null, prev_duration_min: null, interviewer: { id: "c1", name: "Neha", email: "neha@vedam.org" }, baseline: null,
    student: { name: "Ravi", email: "ravi@example.com", application_no: "V-1", lead_id: "lead-1" }, meet_link: null, meet_mode: "auto",
  };
  it("new session → counselling invite to the student, counsellor invite to the counsellor", () => {
    const n = planNotices(job, CS);
    expect(n.map((x) => [x.step, x.key, x.to])).toEqual([
      ["counselling_invite", "student", "ravi@example.com"], ["counsellor_invite", "counsellor:c1", "neha@vedam.org"],
    ]);
  });
  it("moved to another counsellor → old one told it's cancelled, new one invited, student told it moved", () => {
    const moved: NoticeJob = { ...job, kind: "rescheduled", version: 2, slot_start: "2026-11-26T05:30:00Z", interviewer: { id: "c2", name: "Asha", email: "asha@vedam.org" },
      baseline: { kind: "scheduled", slot_start: job.slot_start, duration_min: 30, interviewer: job.interviewer } };
    expect(planNotices(moved, CS).map((x) => x.step)).toEqual(["counselling_rescheduled", "counsellor_cancelled", "counsellor_invite"]);
  });
  it("the interview track is unchanged", () => {
    expect(planNotices(job).map((x) => [x.step, x.key])).toEqual([["interview_invite", "student"], ["interviewer_invite", "interviewer:c1"]]);
  });
  it("calendar invite title", () => {
    expect(eventText({ studentName: "Ravi", applicationNo: "V-1", site: "https://x" }, CS).summary).toBe("Vedam counselling session: Ravi (V-1)");
    expect(eventText({ studentName: "Ravi", applicationNo: "V-1", site: "https://x" }).summary).toBe("Vedam admissions interview: Ravi (V-1)");
    expect(eventText({ studentName: null, applicationNo: null, site: "" }, CS).description).toMatch(/^Your Vedam counselling session on Google Meet\./);
  });
});

describe("Counselling panel rows (plan)", () => {
  it("reads counsellor_id as the row's host", () => {
    const r = toPlanRow({ application_id: "A1", attempt_no: 1, state: "changed", problem: null, clash_with: null,
      booked: { counsellor_id: "c1", slot: "2026-11-25T05:30:00Z", duration_min: 30, meet_mode: "auto" },
      draft: { counsellor_id: "c2", slot: "2026-11-25T06:00:00Z" } });
    expect(r?.booked?.interviewer_id).toBe("c1");
    expect(r?.draft?.interviewer_id).toBe("c2");
  });
});

describe("student card copy (counselling)", () => {
  it("before a session: interview done / cleared / waiting for a time", () => {
    expect(counsellingCardCopy("none", "interviewed")).toEqual({ title: "Your interview is done", text: "We'll email you the result." });
    expect(counsellingCardCopy("none", "pi_cleared").title).toBe("You've cleared the interview");
    expect(counsellingCardCopy("none", "counselling").text).toMatch(/book your counselling session soon/);
  });
  it("booked / live / missed / done, no emoji", () => {
    expect(counsellingCardCopy("upcoming", "counselling", { opensAt: "2026-11-25T05:20:00Z" }).text)
      .toBe("The Join button opens at 10:50 am IST, 10 minutes before your session.");
    expect(counsellingCardCopy("open", "counselling", { hasLink: true }).text).toBe("");
    expect(counsellingCardCopy("missed", "counselling").title).toBe("You missed your counselling session");
    for (const ph of ["none", "upcoming", "open", "missed", "ended", "error", "no_campus", "loading"] as const) {
      const c = counsellingCardCopy(ph, "counselling");
      expect(c.title + c.text).not.toMatch(/\p{Extended_Pictographic}/u);
    }
    // the interview card copy is unchanged
    expect(interviewCardCopy("ended")).toEqual({ title: "Your interview is done", text: "We'll email you the result." });
  });
  it("only known steps are accepted", () => {
    expect(["interview", "interviewed", "pi_cleared", "counselling"].every(isCounsellingStep)).toBe(true);
    expect(isCounsellingStep("offer_sent")).toBe(false);
  });
});

// ── server jobs on the counselling track ─────────────────────────────────────

function fakeDb(answers: Record<string, unknown>) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const db = {
    rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return { data: answers[fn] ?? null, error: null }; },
  } as unknown as SupabaseClient;
  return { db, calls };
}
function fakeGoogle() {
  const made: EventInput[] = [];
  const ev = (id: string): CalEvent => ({ id, status: "confirmed", hangoutLink: "https://meet.google.com/abc-defg-hij", conferenceData: { conferenceId: "abc-defg-hij" } });
  const g = {
    configured: () => true, inviteModeLive: () => false, invitesAllowed: () => true, organizerEmail: () => "admissions@vedam.org",
    createEvent: async (e: EventInput) => { made.push(e); return ev(e.id); },
    getEvent: async (id: string) => ev(id), patchEvent: async (id: string) => ev(id), deleteEvent: async () => undefined,
    conferenceRecords: async () => [], attendees: async () => [],
  } as unknown as GoogleAccount;
  return { g, made };
}
const ID = "22222222-2222-4222-8222-222222222222";

describe("server jobs · counselling track", () => {
  it("Google: counselling functions, the counsellor as a guest, a 'vc' event id", async () => {
    const claim = [{ id: ID, version: 1, claimed_at: "2026-11-23T10:00:00Z", attempts: 1, application_id: "A1",
      slot_start: new Date(Date.now() + 86_400_000).toISOString(), duration_min: 30, meet_mode: "auto", cancelled: false,
      calendar_event_id: null, event_gen: 0, event_version: null,
      student: { name: "Ravi", email: "ravi@example.com", application_no: "V-1" }, counsellor: { id: "c1", name: "Neha", email: "neha@vedam.org" } }];
    const { db, calls } = fakeDb({ vsat_counselling_sync_claim: claim, vsat_counselling_sync_release: { applied: true } });
    const { g, made } = fakeGoogle();
    const r = await syncInterviews(db, { ids: ["A1"] }, g, CS);
    expect(r).toMatchObject({ claimed: 1, ok: 1 });
    expect(calls.map((c) => c.fn)).toEqual(["vsat_counselling_sync_claim", "vsat_counselling_sync_release"]);
    expect(made[0].attendees).toEqual(["ravi@example.com", "neha@vedam.org"]);
    expect(made[0].id).toBe(`vc${ID.replace(/-/g, "")}g0`);
    expect(made[0].summary).toBe("Vedam counselling session: Ravi (V-1)");
  });
  it("emails: counselling steps, counselling notice functions", async () => {
    const job = { id: "ev-9", kind: "scheduled", version: 1, attempts: 1, sent_to: [], slot_start: "2026-11-25T05:30:00Z", duration_min: 30,
      prev_slot_start: null, prev_duration_min: null, counsellor: { id: "c1", name: "Neha", email: "neha@vedam.org" }, baseline: null,
      student: { name: "Ravi", email: "ravi@example.com", application_no: "V-1", lead_id: "lead-1" }, meet_link: null, meet_mode: "auto" };
    const { db, calls } = fakeDb({ vsat_counselling_notices_claim: [job], vsat_counselling_notice_done: { updated: true } });
    const step = (k: string) => [k, { step_key: k, title: k, enabled: true, test_mode: false, email_enabled: true, email_subject: "S {{date}}", email_body: "<p>{{name}}</p>" }] as const;
    const config: NoticeConfig = { master: true, testEmail: "", steps: new Map([step("counselling_invite"), step("counsellor_invite")]) };
    const sent: Record<string, unknown>[] = [];
    const r = await sendInterviewNotices(db, { waitForMeet: false }, { config, deliver: async (o) => { sent.push(o); return { ok: true }; } }, CS);
    expect(r).toMatchObject({ jobs: 1, sent: 2 });
    expect(sent.map((s) => [s.kind, s.to])).toEqual([["vsat_counselling_invite", "ravi@example.com"], ["vsat_counsellor_invite", "neha@vedam.org"]]);
    expect(calls.at(-1)).toEqual({ fn: "vsat_counselling_notice_done", args: { p: { id: "ev-9", status: "sent", detail: { sent_to: ["student", "counsellor:c1"], sent_now: 2 } } } });
  });
  it("attendance: counselling functions", async () => {
    const { db, calls } = fakeDb({ vsat_counselling_attendance_due: [] });
    const { g } = fakeGoogle();
    await checkInterviewAttendance(db, 5, g, Date.now(), CS);
    expect(calls[0]).toEqual({ fn: "vsat_counselling_attendance_due", args: { p_limit: 5 } });
  });
});
