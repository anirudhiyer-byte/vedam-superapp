import { describe, expect, it } from "vitest";
import {
  EMPTY_CELLS, blockedText, cellValues, draftPayload, fillResultText, isEditable, isSendable, parsePlan, sameCells, selectionSummary,
  lockedCells, lockedStatus, sendLabel, sendResultText, statusOf, toPlanRow, type PlanRow,
} from "./interview-plan";
import { TRACKS } from "./tracks";

const I1 = "11111111-1111-4111-8111-111111111111";
const I2 = "22222222-2222-4222-8222-222222222222";
const row = (o: Partial<PlanRow> & { application_id: string; state: PlanRow["state"] }): PlanRow => ({
  attempt_no: 1, problem: null, clash_with: null, booked: null, draft: null, ...o,
});

describe("plan from the database", () => {
  it("reads a well-formed entry", () => {
    const r = toPlanRow({
      application_id: "A1", attempt_no: 1, state: "changed", problem: null, clash_with: null,
      booked: { interviewer_id: I1, slot: "2026-11-25T05:30:00+00:00", duration_min: 45, meet_mode: "auto" },
      draft: { interviewer_id: I2, slot: "2026-11-25T06:30:00+00:00", updated_at: "2026-11-23T00:00:00Z" },
    });
    expect(r?.state).toBe("changed");
    expect(r?.booked?.duration_min).toBe(45);
    expect(r?.draft?.interviewer_id).toBe(I2);
  });
  it("drops malformed entries instead of guessing", () => {
    expect(toPlanRow(null)).toBeNull();
    expect(toPlanRow({ application_id: "A1", state: "hacked" })).toBeNull();
    expect(toPlanRow({ application_id: 5, state: "ready" })).toBeNull();
    const m = parsePlan([{ application_id: "A1", state: "empty" }, { nope: true }, "x"]);
    expect([...m.keys()]).toEqual(["A1"]);
    expect(parsePlan({}).size).toBe(0);
  });
  it("a booking without a slot or interviewer is not treated as booked", () => {
    expect(toPlanRow({ application_id: "A1", state: "booked", booked: { interviewer_id: I1 } })?.booked).toBeNull();
  });
});

describe("what the cells show", () => {
  it("typed values first, then the booking, else empty (times in IST)", () => {
    const booked = { interviewer_id: I1, slot: "2026-11-25T05:30:00Z", duration_min: 30, meet_mode: "auto" };
    expect(cellValues(row({ application_id: "A", state: "booked", booked }))).toEqual({ interviewer_id: I1, date: "2026-11-25", time: "11:00" });
    expect(cellValues(row({ application_id: "A", state: "changed", booked, draft: { interviewer_id: I2, slot: "2026-11-25T18:45:00Z" } })))
      .toEqual({ interviewer_id: I2, date: "2026-11-26", time: "00:15" });
    expect(cellValues(row({ application_id: "A", state: "incomplete", draft: { interviewer_id: I1, slot: null } })))
      .toEqual({ interviewer_id: I1, date: "", time: "" });
    expect(cellValues(undefined)).toEqual(EMPTY_CELLS);
  });
});

describe("what to save when a cell changes", () => {
  it("interviewer + date + time → an IST time", () => {
    expect(draftPayload("A", { interviewer_id: I1, date: "2026-11-25", time: "10:00" }))
      .toEqual({ application_id: "A", interviewer_id: I1, slot_datetime: "2026-11-25T10:00:00+05:30" });
  });
  it("only a date (or only a time) waits on screen", () => {
    expect(draftPayload("A", { interviewer_id: I1, date: "2026-11-25", time: "" })).toBe("partial");
    expect(draftPayload("A", { interviewer_id: "", date: "", time: "10:00" })).toBe("partial");
  });
  it("interviewer alone is saved; all empty clears the row", () => {
    expect(draftPayload("A", { interviewer_id: I1, date: "", time: "" })).toEqual({ application_id: "A", interviewer_id: I1, slot_datetime: null });
    expect(draftPayload("A", EMPTY_CELLS)).toEqual({ application_id: "A", interviewer_id: null, slot_datetime: null });
  });
  it("a broken date never becomes a time", () => {
    expect(draftPayload("A", { interviewer_id: I1, date: "2026-13-45", time: "10:00" })).toBe("partial");
  });
  it("same cells", () => {
    expect(sameCells({ interviewer_id: I1, date: "2026-11-25", time: "10:00" }, { interviewer_id: I1, date: "2026-11-25", time: "10:00" })).toBe(true);
    expect(sameCells({ interviewer_id: I1, date: "2026-11-25", time: "10:00" }, { interviewer_id: I1, date: "2026-11-25", time: "10:30" })).toBe(false);
  });
});

describe("selection → what Send does", () => {
  const plan = parsePlan([
    { application_id: "R1", state: "ready" }, { application_id: "R2", state: "ready" }, { application_id: "C1", state: "changed" },
    { application_id: "P1", state: "problem", problem: "CLASH" }, { application_id: "I1", state: "incomplete" },
    { application_id: "B1", state: "booked" }, { application_id: "L1", state: "locked" },
  ]);
  it("counts invites, updates and the rows that can't go", () => {
    const s = selectionSummary(["R1", "C1", "P1", "I1", "B1", "L1", "R2", "GONE"], plan);
    expect(s).toEqual({ invites: ["R1", "R2"], updates: ["C1"], problems: 1, incomplete: 1 });
    expect(sendLabel(s)).toBe("Send 2 invites + 1 update");
    expect(blockedText(s)).toBe("1 has a problem · 1 needs interviewer, date and time");
  });
  it("labels", () => {
    expect(sendLabel({ invites: ["a"], updates: [], problems: 0, incomplete: 0 })).toBe("Send 1 invite");
    expect(sendLabel({ invites: [], updates: ["a", "b"], problems: 0, incomplete: 0 })).toBe("Send 2 updates");
    expect(sendLabel({ invites: [], updates: [], problems: 0, incomplete: 0 })).toBe("Send invites");
    expect(blockedText({ invites: [], updates: [], problems: 2, incomplete: 0 })).toBe("2 have a problem");
  });
  it("only ready / changed rows are sent; locked rows can't be edited", () => {
    expect(isSendable(plan.get("R1"))).toBe(true);
    expect(isSendable(plan.get("C1"))).toBe(true);
    expect(isSendable(plan.get("P1"))).toBe(false);
    expect(isSendable(plan.get("B1"))).toBe(false);
    expect(isEditable(plan.get("L1"))).toBe(false);
    expect(isEditable(plan.get("B1"))).toBe(true);
    expect(isEditable(undefined)).toBe(false);
  });
});

describe("status cell", () => {
  it("each state in plain words", () => {
    expect(statusOf(row({ application_id: "A", state: "ready" }))).toMatchObject({ label: "Not sent", tone: "violet" });
    expect(statusOf(row({ application_id: "A", state: "changed" }))).toMatchObject({ label: "Change not sent", tone: "violet" });
    expect(statusOf(row({ application_id: "A", state: "booked" }))).toMatchObject({ label: "Booked", tone: "green" });
    expect(statusOf(row({ application_id: "A", state: "incomplete" }))).toMatchObject({ label: "Fill all three", tone: "orange" });
    expect(statusOf(row({ application_id: "A", state: "empty" })).label).toBe("—");
    expect(statusOf(null).label).toBe("—");
  });
  it("a clash names the other student, or says 'another student' when that one is hidden", () => {
    expect(statusOf(row({ application_id: "A", state: "problem", problem: "CLASH", clash_with: { application_id: "B", name: "Tanvi Pillai" } })).label)
      .toBe("Clashes with Tanvi Pillai");
    expect(statusOf(row({ application_id: "A", state: "problem", problem: "CLASH", clash_with: { application_id: null, name: null } })).label)
      .toBe("Clashes with another student");
  });
  it("other problems use the plain error text", () => {
    expect(statusOf(row({ application_id: "A", state: "problem", problem: "SLOT_IN_PAST" }))).toMatchObject({ label: "Pick a time in the future.", tone: "red" });
  });
});

describe("result messages", () => {
  it("send", () => {
    expect(sendResultText({ sent: [{ application_id: "A", name: "Tanvi", kind: "scheduled", slot: "x" }], skipped: [] })).toBe("Sent 1 ✓");
    expect(sendResultText({
      sent: [{ application_id: "A", name: "Tanvi", kind: "scheduled", slot: "x" }, { application_id: "B", name: "Nikhil", kind: "rescheduled", slot: "y" }],
      skipped: [{ application_id: "C", name: "Kunal", code: "CLASH" }],
    })).toBe("Sent 2 ✓ (1 invite, 1 update). Not sent: Kunal (The interviewer has another student at this time.).");
    expect(sendResultText({ sent: [], skipped: [{ application_id: "C", name: null, code: "SLOT_TAKEN" }] }))
      .toBe("Nothing was sent. Not sent: C (That person already has another student at this time.).");
  });
  it("fill", () => {
    expect(fillResultText({ filled: [{ application_id: "A", name: "T", slot: "x" }, { application_id: "B", name: "N", slot: "y" }], skipped: [] }))
      .toBe("Filled 2 rows. Check the times, then press Send.");
    expect(fillResultText({ filled: [], skipped: [{ application_id: "K", name: "Kunal", code: "ALREADY_SCHEDULED" }] }))
      .toBe("No row was filled. Skipped: Kunal (Already has an interview booked. Open the student to move it.).");
  });
  it("long skip lists are shortened", () => {
    const skipped = Array.from({ length: 6 }, (_, i) => ({ application_id: `S${i}`, name: `N${i}`, code: "CLASH" }));
    expect(sendResultText({ sent: [], skipped })).toMatch(/and 2 more\.$/);
  });
});

describe("locked rows show their booking as words, not a greyed-out dropdown", () => {
  it("date as '31 Oct 2026' and time as '19:00' (IST, from the cells)", () => {
    expect(lockedCells({ interviewer_id: I1, date: "2026-10-31", time: "19:00" })).toEqual({ date: "31 Oct 2026", time: "19:00" });
    expect(lockedCells({ interviewer_id: I1, date: "2026-01-05", time: "09:30" })).toEqual({ date: "5 Jan 2026", time: "09:30" });
  });
  it("nothing booked → a dash", () => {
    expect(lockedCells(EMPTY_CELLS)).toEqual({ date: "—", time: "—" });
  });
  it("a value that is not a real date or time → a dash, never 'undefined'", () => {
    expect(lockedCells({ interviewer_id: "", date: "2026-13-01", time: "7pm" })).toEqual({ date: "—", time: "—" });
    expect(lockedCells({ interviewer_id: "", date: "2026-00-10", time: "" })).toEqual({ date: "—", time: "—" });
  });
  it("matches what a booked locked row's cells hold", () => {
    const r = row({ application_id: "A", state: "locked", booked: { interviewer_id: I2, slot: "2026-10-31T13:30:00+00:00", duration_min: 30, meet_mode: "auto" } });
    expect(lockedCells(cellValues(r))).toEqual({ date: "31 Oct 2026", time: "19:00" });
  });
});

describe("locked rows say why", () => {
  const C = TRACKS.counselling, I = TRACKS.interview;
  it("past the counselling step: the stage, and when times can be set", () => {
    expect(lockedStatus(C, "offer_sent", "active")).toEqual({
      label: "Locked: Offer sent", tone: "neutral",
      title: "This student is at Offer sent. Counselling session times can be set only at PI cleared or Counselling scheduled.",
    });
    expect(lockedStatus(C, "offer_lapsed", "active").label).toBe("Locked: Offer lapsed");
    expect(lockedStatus(C, "counselled", "active").label).toBe("Locked: Counselled");
    expect(lockedStatus(C, "counselling_not_appeared", "absent").label).toBe("Locked: Counselling not appeared");
    expect(lockedStatus(C, "enrolled", "active").label).toBe("Locked: Enrolled");
  });
  it("past the interview step", () => {
    expect(lockedStatus(I, "pi_cleared", "active")).toEqual({
      label: "Locked: PI cleared", tone: "neutral",
      title: "This student is at PI cleared. Interview times can be set only at VSAT cleared or Interview scheduled.",
    });
    expect(lockedStatus(I, "interviewed", "active").label).toBe("Locked: Interviewed");
    expect(lockedStatus(I, "pi_not_appeared", "absent").label).toBe("Locked: PI not appeared");
  });
  it("at the right stage but Not selected", () => {
    expect(lockedStatus(C, "pi_cleared", "not_selected")).toMatchObject({ label: "Locked: Not selected", title: "This student is marked Not selected, so no counselling session can be booked." });
    expect(lockedStatus(I, "interview_scheduled", "not_selected").label).toBe("Locked: Not selected");
  });
  it("at the right stage and active: the meeting is already done", () => {
    expect(lockedStatus(C, "counselling_scheduled", "active")).toMatchObject({
      label: "Locked: Counselling done", title: "The counselling session is already done and submitted, so its time can't be changed.",
    });
    expect(lockedStatus(I, "vsat_cleared", "active")).toMatchObject({
      label: "Locked: Interview done", title: "The interview is already done and submitted, so its time can't be changed.",
    });
  });
  it("past the step wins over Not selected (the stage is the reason the time can't move)", () => {
    expect(lockedStatus(C, "offer_lapsed", "not_selected").label).toBe("Locked: Offer lapsed");
  });
  it("missing or unknown stage: just 'Locked', still with the rule on hover", () => {
    for (const s of [undefined, null, "", "made_up"]) {
      expect(lockedStatus(C, s, "active")).toEqual({
        label: "Locked", tone: "neutral", title: "Counselling session times can be set only at PI cleared or Counselling scheduled.",
      });
    }
  });
  it("counselling text never talks about interviews, interview text never about counselling", () => {
    for (const st of ["pi_cleared", "counselling_scheduled", "counselled", "offer_sent", "enrolled", "offer_lapsed", "offer_cancelled"]) {
      const s = lockedStatus(C, st, "active");
      expect(`${s.label} ${s.title}`).not.toMatch(/interview/i);
    }
    for (const st of ["vsat_cleared", "interview_scheduled", "interviewed", "pi_cleared", "pi_not_appeared"]) {
      const s = lockedStatus(I, st, "active");
      expect(`${s.label} ${s.title}`).not.toMatch(/counsell/i);
    }
  });
  it("statusOf itself is unchanged for a locked row (the panel asks lockedStatus)", () => {
    expect(statusOf(row({ application_id: "L", state: "locked" })).label).toBe("—");
  });
});
