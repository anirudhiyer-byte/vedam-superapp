import { describe, expect, it } from "vitest";
import {
  EXTEND_DAYS_ERROR, EXTEND_REASON_ERROR, OFFER_DAYS_ERROR, OFFER_JOB_STEP, OFFER_STEPS, OFFER_VARS, amountText, extendParams, extendResultText,
  extendedDeadline, parseExtendDays, parseExtendReason, parseOfferDays, releaseParams, deadlineText, nothingToReleaseText, offerState, offerVars,
  parseRelease, pctText, previewText, releaseResultText, skipText, type OfferJob,
} from "./offers";
import { fillTemplate } from "./interviews";

// 28 Nov 2026, 11:59:59 pm IST
const DEADLINE = "2026-11-28T18:29:59Z";

describe("formatting", () => {
  it("scholarship % without trailing zeros", () => {
    expect(pctText(40)).toBe("40");
    expect(pctText("37.50")).toBe("37.5");
    expect(pctText(null)).toBe("");
    expect(pctText("abc")).toBe("");
  });
  it("fee in Indian grouping", () => {
    expect(amountText("50000")).toBe("50,000");
    expect(amountText(150000)).toBe("1,50,000");
    expect(amountText(undefined)).toBe("");
  });
  it("deadline in IST, with the day", () => {
    expect(deadlineText(DEADLINE)).toBe("Sat, 28 Nov 2026, 11:59 pm IST");
    expect(deadlineText(null)).toBe("—");
  });
});

describe("parseRelease", () => {
  it("keeps only well-formed rows", () => {
    const r = parseRelease({
      released: [{ application_id: "A1", name: "Ravi", scholarship_pct: 40, expires_at: DEADLINE }, { name: "no id" }, "x"],
      skipped: [{ application_id: "A2", name: null, code: "NO_SCHOLARSHIP" }, { code: "X" }],
      dry_run: true,
    });
    expect(r.released).toEqual([{ application_id: "A1", name: "Ravi", scholarship_pct: 40, expires_at: DEADLINE }]);
    expect(r.skipped).toEqual([{ application_id: "A2", name: null, code: "NO_SCHOLARSHIP" }]);
    expect(r.dry_run).toBe(true);
  });
  it("anything else → empty", () => {
    expect(parseRelease(null)).toEqual({ released: [], skipped: [], dry_run: false });
    expect(parseRelease("x")).toEqual({ released: [], skipped: [], dry_run: false });
  });
});

describe("release texts", () => {
  const two = parseRelease({
    released: [{ application_id: "A1", name: "Ravi", scholarship_pct: 40, expires_at: DEADLINE }, { application_id: "A3", name: "Meera", scholarship_pct: 25, expires_at: DEADLINE }],
    skipped: [{ application_id: "A2", name: "Kabir", code: "NO_SCHOLARSHIP" }],
  });
  it("preview: how many, the deadline, who is left out and why", () => {
    expect(previewText(two)).toBe(
      "Release 2 offers? Each student gets an email with their scholarship and can then pay the enrollment fee from their dashboard. " +
      "They can pay until Sat, 28 Nov 2026, 11:59 pm IST. Left out: Kabir (counselling not saved yet).");
  });
  it("preview: one offer, no deadline line when deadlines differ", () => {
    const mixed = parseRelease({ released: [
      { application_id: "A1", name: "Ravi", expires_at: DEADLINE }, { application_id: "A3", name: "Meera", expires_at: "2026-11-29T18:29:59Z" }] });
    expect(previewText(mixed)).not.toContain("They can pay until");
    expect(previewText(parseRelease({ released: [{ application_id: "A1", name: "Ravi", expires_at: DEADLINE }] }))).toMatch(/^Release 1 offer\?/);
  });
  it("preview: nobody to release → null, with a reason", () => {
    const none = parseRelease({ skipped: [{ application_id: "A1", name: "Ravi", code: "ALREADY_RELEASED" }, { application_id: "A2", name: null, code: "WRONG_STAGE" }] });
    expect(previewText(none)).toBeNull();
    // 0189 (sir): an offer can be released once counselling is Done, so WRONG_STAGE now means "not marked Done yet"
    expect(nothingToReleaseText(none)).toBe("Nothing to release: Ravi (offer already released), A2 (counselling not marked Done yet).");
    expect(nothingToReleaseText(parseRelease({}))).toMatch(/Select students whose counselling is Done/);
  });
  it("result", () => {
    expect(releaseResultText(two)).toBe("Released 2 offers ✓. Not released: Kabir (counselling not saved yet).");
    expect(releaseResultText(parseRelease({}))).toBe("Nothing to release.");
  });
  it("unknown codes read as plain English, never raw database text", () => {
    expect(skipText("STAGE_CHANGED")).toBe("someone else moved this student just now. Refresh and try again");
    expect(skipText('duplicate key value violates unique constraint "x"')).toBe("something went wrong. Please try again");
    expect(skipText("CAMPUS_MISSING")).toMatch(/no campus/);
  });
});

describe("Days to pay at release (0180)", () => {
  it("empty = campus default", () => {
    expect(parseOfferDays("")).toEqual({ ok: true, days: null });
    expect(parseOfferDays("   ")).toEqual({ ok: true, days: null });
  });
  it("whole numbers 1–90 are taken (spaces trimmed)", () => {
    expect(parseOfferDays("1")).toEqual({ ok: true, days: 1 });
    expect(parseOfferDays(" 10 ")).toEqual({ ok: true, days: 10 });
    expect(parseOfferDays("90")).toEqual({ ok: true, days: 90 });
    expect(parseOfferDays("007")).toEqual({ ok: true, days: 7 });
  });
  it("anything else is refused (same limits as the database)", () => {
    for (const bad of ["0", "91", "2.5", "-3", "1e1", "ten", "7 days", "0x10", "1000"]) expect(parseOfferDays(bad)).toEqual({ ok: false });
  });
  it("the call sends offer_days only when typed", () => {
    expect(releaseParams(["A1"], null, true)).toEqual({ application_ids: ["A1"], dry_run: true });
    expect(releaseParams(["A1", "A2"], null, false)).toEqual({ application_ids: ["A1", "A2"] });
    expect(releaseParams(["A1"], 10, true)).toEqual({ application_ids: ["A1"], dry_run: true, offer_days: 10 });
    expect(releaseParams(["A1"], 1, false)).toEqual({ application_ids: ["A1"], offer_days: 1 });
  });
  it("the error names the limits", () => {
    expect(OFFER_DAYS_ERROR).toContain("1 to 90");
  });
});

describe("offerState (drawer)", () => {
  const now = Date.parse("2026-11-25T10:00:00Z");
  const offer = { released_at: "2026-11-23T10:00:00Z", expires_at: DEADLINE, scholarship_pct: 40 };
  it("valid offer → the deadline", () => {
    expect(offerState("offer_sent", offer, now)).toEqual({ label: "Valid until Sat, 28 Nov 2026, 11:59 pm IST", tone: "green" });
  });
  it("past the deadline, before the job runs", () => {
    expect(offerState("offer_sent", offer, Date.parse("2026-11-29T00:00:00Z")).tone).toBe("orange");
  });
  it("lapsed / cancelled / enrolled / not released / moved back", () => {
    expect(offerState("offer_lapsed", offer, now).label).toMatch(/^Lapsed/);
    expect(offerState("offer_cancelled", offer, now).tone).toBe("red");
    expect(offerState("enrolled", offer, now).tone).toBe("green");
    expect(offerState("counselled", null, now)).toEqual({ label: "Not released yet", tone: "neutral" });
    expect(offerState("counselled", offer, now).label).toMatch(/moved back/);
  });
});

describe("offer email", () => {
  const job: OfferJob = {
    id: "ev-1", kind: "released", attempts: 1, sent_to: [], scholarship_pct: 37.5, released_at: "2026-11-23T10:00:00Z",
    expires_at: DEADLINE, amount: "50000",
    student: { name: "Ravi <b>Kumar</b>", email: "ravi@example.com", lead_id: "lead-1", application_no: "V-1", campus: "pune" },
  };
  it("fills every placeholder the comms panel lists", () => {
    const v = offerVars(job, "https://one.vedam.org");
    expect(v).toEqual({
      name: "Ravi", student_name: "Ravi <b>Kumar</b>", application_no: "V-1", campus: "Pune", scholarship: "37.5", amount: "50,000",
      deadline_date: "Sat, 28 Nov 2026", deadline_time: "11:59 pm", dashboard_link: "https://one.vedam.org/apply/dashboard",
    });
    for (const k of OFFER_VARS) expect(v[k]).toBeTypeOf("string");
  });
  it("a typed name never becomes HTML", () => {
    const html = fillTemplate("<p>Hi {{student_name}}</p>", offerVars(job, "https://x"), "html");
    expect(html).toBe("<p>Hi Ravi &lt;b&gt;Kumar&lt;/b&gt;</p>");
  });
  it("unknown campus / missing fee fall back safely", () => {
    const v = offerVars({ ...job, amount: null, student: { ...job.student, campus: null, name: null } }, "https://x");
    expect(v).toMatchObject({ campus: "Vedam", amount: "50,000", name: "there" });
  });
});

describe("0189 · sir's two reminders and OL Date Increase", () => {
  it("each offer email job has its own VSAT comms step; the 0157 last-day step is gone", () => {
    expect(OFFER_JOB_STEP).toEqual({ released: "offer_released", reminder_1: "offer_reminder_1", reminder_2: "offer_reminder_2", lapsed: "offer_lapsed" });
    expect(OFFER_STEPS).toEqual(["offer_released", "offer_reminder_1", "offer_reminder_2", "offer_lapsed"]);
    expect(OFFER_STEPS).not.toContain("offer_reminder");
  });
  it("days to add: a whole number 1–90; anything else refused", () => {
    expect(parseExtendDays("3")).toEqual({ ok: true, days: 3 });
    expect(parseExtendDays(" 90 ")).toEqual({ ok: true, days: 90 });
    for (const bad of ["", "0", "91", "1.5", "-2", "abc", "3 days", "100"]) expect(parseExtendDays(bad)).toEqual({ ok: false });
    expect(EXTEND_DAYS_ERROR).toMatch(/1 to 90/);
  });
  it("reason: 3–500 characters after trimming", () => {
    expect(parseExtendReason("  parents travelling  ")).toEqual({ ok: true, reason: "parents travelling" });
    for (const bad of ["", "  ", "ab", "x".repeat(501)]) expect(parseExtendReason(bad)).toEqual({ ok: false });
    expect(EXTEND_REASON_ERROR).toMatch(/at least 3/);
  });
  it("the call body carries exactly the three keys the database accepts", () => {
    expect(extendParams("APP-1", 3, "parents travelling")).toEqual({ application_id: "APP-1", days: 3, reason: "parents travelling" });
  });
  it("the new last date: the old IST day + N, still 11:59:59 pm IST", () => {
    expect(extendedDeadline(DEADLINE, 3)).toBe("2026-12-01T18:29:59.000Z");
    expect(extendedDeadline("2026-11-30T18:29:59Z", 1)).toBe("2026-12-01T18:29:59.000Z");   // month change
    expect(extendedDeadline(null, 3)).toBeNull();
    expect(extendedDeadline("not a date", 3)).toBeNull();
  });
  it("the message after extending", () => {
    expect(extendResultText({ days: 3, total_days: 3, expires_at: "2026-12-01T18:29:59Z" })).toBe("Last date moved 3 days on: Tue, 1 Dec 2026, 11:59 pm IST ✓");
    expect(extendResultText({ days: 1, total_days: 5, expires_at: "2026-12-01T18:29:59Z" }))
      .toBe("Last date moved 1 day on: Tue, 1 Dec 2026, 11:59 pm IST (5 days added in total) ✓");
    expect(extendResultText(null)).toBe("Last date extended ✓");
  });
});
