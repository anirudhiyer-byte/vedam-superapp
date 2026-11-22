import { describe, expect, it } from "vitest";
import {
  attendanceOutcome, clockSkewMs, escapeHtml, eventText, fillTemplate, interviewEventId, isLive, isMeetUrl, istDate, istParts, joinUrl,
  istSlotIso, istTimeRange, joinPhase, meetErrorText, meetState, msToNextPhase, noticeVars, parseIdList, planNotices,
  type MyInterview, type NoticeJob,
} from "./interviews";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

function job(over: Partial<NoticeJob> = {}): NoticeJob {
  return {
    id: "e1", kind: "scheduled", version: 1, attempts: 1, sent_to: [],
    slot_start: "2026-11-25T05:30:00Z", duration_min: 30, prev_slot_start: null, prev_duration_min: null,
    interviewer: { id: A, name: "Asha Rao", email: "asha@vedam.org" },
    baseline: null,
    student: { name: "Ravi Kumar", email: "ravi@example.com", application_no: "VSAT-0042", lead_id: "lead-1" },
    meet_link: "https://meet.google.com/abc-defg-hij", meet_mode: "auto",
    ...over,
  };
}

describe("formatting (IST)", () => {
  it("shows the date and a time range in IST", () => {
    expect(istDate("2026-11-25T05:30:00Z")).toMatch(/Wed.*25 Nov 2026/);
    expect(istTimeRange("2026-11-25T05:30:00Z", 30)).toBe("11:00 am – 11:30 am IST");
    expect(istTimeRange("2026-11-25T05:30:00Z", 45)).toBe("11:00 am – 11:45 am IST");
    expect(istTimeRange(null, 30)).toBe("—");
  });
  it("date + time inputs ↔ ISO round trip", () => {
    const iso = istSlotIso("2026-11-25", "11:00");
    expect(iso).toBe("2026-11-25T11:00:00+05:30");
    expect(istParts(iso)).toEqual({ date: "2026-11-25", time: "11:00" });
    expect(istParts("2026-11-25T20:00:00Z")).toEqual({ date: "2026-11-26", time: "01:30" });
    expect(istSlotIso("25/11/2026", "11:00")).toBeNull();
    expect(istSlotIso("2026-11-25", "")).toBeNull();
  });
});

describe("request ids", () => {
  it("accepts 1..max strings, de-duplicated", () => {
    expect(parseIdList(["a", "b", "a"], 5)).toEqual(["a", "b"]);
    expect(parseIdList([], 5)).toBeNull();
    expect(parseIdList(["a", 1], 5)).toBeNull();
    expect(parseIdList(["x".repeat(65)], 5)).toBeNull();
    expect(parseIdList(["a", "b", "c"], 2)).toBeNull();
    expect(parseIdList("a", 5)).toBeNull();
  });
});

describe("Meet state", () => {
  it("matches the grid's interview_meet rule", () => {
    expect(meetState(null)).toBeNull();
    expect(meetState({ cancelled_at: "x", meet_mode: "auto", meet_sync: "ok" })).toBe("cancelled");
    expect(meetState({ meet_mode: "manual", meet_sync: "pending" })).toBe("own_link");
    expect(meetState({ meet_mode: "auto", meet_sync: "ok" })).toBe("ready");
    expect(meetState({ meet_mode: "auto", meet_sync: "syncing" })).toBe("creating");
    expect(meetState({ meet_mode: "auto", meet_sync: "failed" })).toBe("failed");
  });
  it("live = not cancelled, with a time and an interviewer", () => {
    expect(isLive({ slot_datetime: "t", interviewer_id: A })).toBe(true);
    expect(isLive({ slot_datetime: "t", interviewer_id: A, cancelled_at: "c" })).toBe(false);
    expect(isLive({ slot_datetime: null, interviewer_id: A })).toBe(false);
  });
  it("explains Google failures in plain words, never raw text", () => {
    expect(meetErrorText("test_mode: an attendee is not on ADMISSIONS_TEST_EMAILS")).toMatch(/test mode/i);
    expect(meetErrorText("403 {\"error\": ...}")).toBe("Google did not accept the request. Try again, or use your own link.");
    expect(meetErrorText(null)).toBe("");
  });
});

describe("attendance from Meet → what we save", () => {
  it("joined together → done; nobody / only one → no-show; short call / no record → admin marks", () => {
    expect(attendanceOutcome({ result: "completed", people: 2, overlapMin: 25 })).toBe("done");
    expect(attendanceOutcome({ result: "needs_marking", reason: "nobody_joined", people: 0, overlapMin: 0 })).toBe("no_show");
    expect(attendanceOutcome({ result: "needs_marking", reason: "one_joined", people: 1, overlapMin: 0 })).toBe("no_show");
    expect(attendanceOutcome({ result: "needs_marking", reason: "too_short", people: 2, overlapMin: 2 })).toBe("needs_marking");
    expect(attendanceOutcome({ result: "needs_marking", reason: "no_record", people: 0, overlapMin: 0 })).toBe("needs_marking");
    expect(attendanceOutcome({ result: "needs_marking", reason: "check_failed", people: 0, overlapMin: 0 })).toBe("needs_marking");
  });
});

describe("Google event", () => {
  it("event ids use only a–v and 0–9 and change with the generation", () => {
    const id0 = interviewEventId(A, 0), id1 = interviewEventId(A, 1);
    expect(id0).toMatch(/^[a-v0-9]{5,}$/);
    expect(id0).not.toBe(id1);
    expect(id0).toBe("vi11111111111141118111111111111111g0");
  });
  it("invite text names the student and the dashboard", () => {
    const t = eventText({ studentName: "Ravi Kumar", applicationNo: "VSAT-0042", site: "https://one.vedam.org" });
    expect(t.summary).toBe("Vedam admissions interview: Ravi Kumar (VSAT-0042)");
    expect(t.description).toContain("https://one.vedam.org/apply/dashboard");
    expect(eventText({ studentName: null, applicationNo: null, site: "" }).summary).toBe("Vedam admissions interview");
  });
});

describe("student Join button", () => {
  const mi: MyInterview = {
    state: "upcoming", now: "2026-11-25T05:00:00Z", start: "2026-11-25T05:30:00Z", end: "2026-11-25T06:00:00Z",
    opens_at: "2026-11-25T05:20:00Z", duration_min: 30, has_link: true, meet_link: null,
  };
  it("follows the server clock, not the phone clock", () => {
    const phoneIsFiveMinutesSlow = Date.parse("2026-11-25T04:55:00Z");
    const skew = clockSkewMs(mi.now, phoneIsFiveMinutesSlow);
    expect(skew).toBe(5 * 60_000);
    expect(joinPhase(mi, Date.parse("2026-11-25T05:14:00Z"), skew)).toBe("upcoming"); // server 05:19
    expect(joinPhase(mi, Date.parse("2026-11-25T05:15:00Z"), skew)).toBe("open");     // server 05:20
    expect(joinPhase(mi, Date.parse("2026-11-25T05:55:00Z"), skew)).toBe("ended");    // server 06:00
  });
  it("time to the next change of phase", () => {
    expect(msToNextPhase(mi, Date.parse("2026-11-25T05:10:00Z"), 0)).toBe(10 * 60_000);
    expect(msToNextPhase(mi, Date.parse("2026-11-25T05:30:00Z"), 0)).toBe(30 * 60_000);
    expect(msToNextPhase(mi, Date.parse("2026-11-25T06:30:00Z"), 0)).toBeNull();
  });
  it("missed / none stay as the server said", () => {
    expect(joinPhase({ ...mi, state: "missed" }, Date.parse("2026-11-25T05:25:00Z"), 0)).toBe("missed");
    expect(joinPhase({ state: "none", now: mi.now }, Date.now(), 0)).toBe("none");
  });
  it("only Google Meet links are opened", () => {
    expect(isMeetUrl("https://meet.google.com/abc-defg-hij")).toBe(true);
    expect(isMeetUrl("javascript:alert(1)")).toBe(false);
    expect(isMeetUrl("https://meet.google.com.evil.com/x")).toBe(false);
    expect(isMeetUrl(null)).toBe(false);
  });
  it("the Join button opens https links only (Meet, or staff's own Zoom / Teams link)", () => {
    expect(joinUrl("https://meet.google.com/abc-defg-hij")).toBe("https://meet.google.com/abc-defg-hij");
    expect(joinUrl("https://us02web.zoom.us/j/123?pwd=x")).toBe("https://us02web.zoom.us/j/123?pwd=x");
    expect(joinUrl("javascript:alert(1)")).toBeNull();
    expect(joinUrl("http://meet.google.com/abc")).toBeNull();
    expect(joinUrl("https://user:pw@evil.com/")).toBeNull();
    expect(joinUrl("data:text/html,x")).toBeNull();
    expect(joinUrl(42)).toBeNull();
  });
});

describe("who gets which email", () => {
  it("first booking → invite to student and interviewer", () => {
    expect(planNotices(job()).map((n) => `${n.key}:${n.step}`)).toEqual(["student:interview_invite", `interviewer:${A}:interviewer_invite`]);
  });
  it("a move before anything was emailed is still an invite", () => {
    expect(planNotices(job({ kind: "rescheduled" })).map((n) => n.step)).toEqual(["interview_invite", "interviewer_invite"]);
  });
  it("moved, same interviewer → 'moved' to both, with the old time", () => {
    const p = planNotices(job({ kind: "rescheduled", slot_start: "2026-11-26T05:30:00Z",
      baseline: { kind: "scheduled", slot_start: "2026-11-25T05:30:00Z", duration_min: 30, interviewer: { id: A, name: "Asha Rao", email: "asha@vedam.org" } } }));
    expect(p.map((n) => n.step)).toEqual(["interview_rescheduled", "interviewer_rescheduled"]);
    expect(p[0].oldSlot).toBe("2026-11-25T05:30:00Z");
  });
  it("new interviewer, same time → old one 'cancelled', new one invited, student not emailed", () => {
    const p = planNotices(job({ kind: "rescheduled", interviewer: { id: B, name: "Bala", email: "bala@vedam.org" },
      baseline: { kind: "scheduled", slot_start: "2026-11-25T05:30:00Z", duration_min: 30, interviewer: { id: A, name: "Asha Rao", email: "asha@vedam.org" } } }));
    expect(p.map((n) => `${n.to}:${n.step}`)).toEqual(["asha@vedam.org:interviewer_cancelled", "bala@vedam.org:interviewer_invite"]);
  });
  it("nothing changed for anyone → no email", () => {
    expect(planNotices(job({ kind: "rescheduled",
      baseline: { kind: "scheduled", slot_start: "2026-11-25T05:30:00Z", duration_min: 30, interviewer: { id: A, name: "Asha Rao", email: "asha@vedam.org" } } }))).toEqual([]);
  });
  it("cancel → only people who were told about the old time", () => {
    expect(planNotices(job({ kind: "cancelled", interviewer: null }))).toEqual([]);
    const p = planNotices(job({ kind: "cancelled", interviewer: null,
      baseline: { kind: "rescheduled", slot_start: "2026-11-25T05:30:00Z", duration_min: 30, interviewer: { id: A, name: "Asha Rao", email: "asha@vedam.org" } } }));
    expect(p.map((n) => n.step)).toEqual(["interview_cancelled", "interviewer_cancelled"]);
    expect(p[0].slot).toBe("2026-11-25T05:30:00Z");
  });
  it("after a sent cancel, a new booking is an invite again", () => {
    expect(planNotices(job({ baseline: { kind: "cancelled", slot_start: null, duration_min: null, interviewer: null } })).map((n) => n.step))
      .toEqual(["interview_invite", "interviewer_invite"]);
  });
  it("a retry skips people who already got it, and people without an email", () => {
    expect(planNotices(job({ sent_to: ["student"] })).map((n) => n.key)).toEqual([`interviewer:${A}`]);
    expect(planNotices(job({ student: { name: "R", email: null, application_no: null, lead_id: null } })).map((n) => n.key)).toEqual([`interviewer:${A}`]);
  });
});

describe("email text", () => {
  it("fills placeholders; HTML values are escaped (names are typed by students)", () => {
    const j = job({ student: { name: "<script>x</script> Ravi", email: "r@x.com", application_no: "V-1", lead_id: null } });
    const n = planNotices(j)[0];
    const v = noticeVars(n, j, "https://one.vedam.org");
    expect(v.date).toMatch(/25 Nov 2026/);
    expect(v.time).toBe("11:00 am – 11:30 am IST");
    expect(v.join_link).toBe("https://meet.google.com/abc-defg-hij");
    expect(fillTemplate("<p>Hi {{student_name}}</p>{{nope}}", v, "html")).toBe("<p>Hi &lt;script&gt;x&lt;/script&gt; Ravi</p>");
    expect(fillTemplate("Interview: {{student_name}}", { student_name: "A\nB" }, "text")).toBe("Interview: A B");
    expect(escapeHtml(`a&b"'`)).toBe("a&amp;b&quot;&#39;");
  });
  it("no Meet link yet → students get the dashboard, interviewers the panel", () => {
    const j = job({ meet_link: null });
    const [s, i] = planNotices(j);
    expect(noticeVars(s, j, "https://x.org").join_link).toBe("https://x.org/apply/dashboard");
    expect(noticeVars(i, j, "https://x.org").join_link).toBe("https://x.org/admin/vsat");
    expect(noticeVars(s, j, "https://x.org").name).toBe("Ravi");
  });
});
