import { describe, expect, it } from "vitest";
import {
  OFFER_VARS, amountText, deadlineText, nothingToReleaseText, offerState, offerVars, parseRelease, pctText, previewText,
  releaseResultText, skipText, type OfferJob,
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
    expect(nothingToReleaseText(none)).toBe("Nothing to release: Ravi (offer already released), A2 (not at Counselled).");
    expect(nothingToReleaseText(parseRelease({}))).toMatch(/Select students at Counselled/);
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
