import { describe, expect, it } from "vitest";
import {
  CHEATING_OPTIONS, NUMBER_QUESTIONS, PART_QUESTIONS, REMARK_MAX, TEXT_QUESTIONS, buildInterviewRequest, emptyInterviewForm,
  type InterviewFormState,
} from "./interview-form";

/** A form with every question answered (as the Google Form requires). */
function filled(): InterviewFormState {
  const f = emptyInterviewForm();
  f.parts = { communication: 4, logic: 3, passion: 5, achievements: 2, why_program: 3 };
  f.remarks = { communication: " Fluent ", logic: "Good guess", passion: "GitHub projects", achievements: "State chess", why_program: "Read about Vedam" };
  f.cheating = "no"; f.coding_talent = "yes"; f.cert_asked = "no"; f.drop_year = "yes";
  f.numbers = {
    jee_pct: { value: "92.45", na: false }, jee_maths_pct: { value: "", na: true }, expected_jee_pct: { value: "", na: true },
    class12_pct: { value: "88", na: false }, class11_pct: { value: "85.5", na: false }, class10_pct: { value: "100", na: false },
  };
  f.text = { previous_jee: "N/A", other_exams: "BITSAT 250", financial_reason: "Father is a salaried engineer", why_accept: "I build things" };
  f.financial = "medium";
  return f;
}

describe("the interview form = sir's Google Form", () => {
  it("has the form's five marked parts in order, each with a remark question", () => {
    expect(PART_QUESTIONS.map((q) => q.key)).toEqual(["communication", "logic", "passion", "achievements", "why_program"]);
    for (const q of PART_QUESTIONS) expect(q.remarkTitle).toMatch(/Remarks$/);
    expect(CHEATING_OPTIONS.map((o) => o.label)).toEqual(["No", "Yes, and hence Reject Straight Away"]);
    expect(NUMBER_QUESTIONS.map((q) => q.key)).toEqual(["jee_pct", "jee_maths_pct", "expected_jee_pct", "class12_pct", "class11_pct", "class10_pct"]);
    expect(TEXT_QUESTIONS.why_accept.title).toBe("Why should Vedam accept your application and what could the batch learn from you?");
  });
});

describe("buildInterviewRequest", () => {
  it("a complete form → the request for vsat_submit_interview (N/A numbers left out, text trimmed)", () => {
    const r = buildInterviewRequest("APP-1", filled());
    expect(r).toEqual({
      ok: true,
      p: {
        application_id: "APP-1",
        communication: 4, logic: 3, passion: 5, achievements: 2, why_program: 3,
        cheating_seen: false, coding_talent: true, cert_asked: false, drop_year: true,
        remarks: { communication: "Fluent", logic: "Good guess", passion: "GitHub projects", achievements: "State chess", why_program: "Read about Vedam" },
        previous_jee: "N/A", jee_pct: 92.45, other_exams: "BITSAT 250", class12_pct: 88, class11_pct: 85.5, class10_pct: 100,
        financial_capability: "medium", financial_reason: "Father is a salaried engineer", why_accept: "I build things",
      },
    });
  });
  it("never sends a verdict: the verdict comes from Interview Evaluation", () => {
    const r = buildInterviewRequest("APP-1", filled());
    expect(r.ok && "interviewer_verdict" in r.p).toBe(false);
  });
  it("cheating Yes → cheating_seen true", () => {
    const f = filled(); f.cheating = "yes";
    const r = buildInterviewRequest("APP-1", f);
    expect(r.ok && r.p.cheating_seen).toBe(true);
  });
  it("an empty form → every question listed, in the form's order", () => {
    const r = buildInterviewRequest("APP-1", emptyInterviewForm());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toEqual([
      "Communication & Behavioral Skills: pick 1 to 5",
      "Behavioural & Communication — Remarks: please write a remark",
      "Guesstimate & Logical Reasoning: pick 1 to 5",
      "Cheating while solving questions: pick an answer",
      "Logical & Reasoning — Remarks: please write a remark",
      "Passion & Motivation for Computer Science: pick 1 to 5",
      "Possible coding talent: pick yes or no",
      "Passion & Motivation for CS — Remarks: please write a remark",
      "Achievements & Extracurricular Activities: pick 1 to 5",
      "National-level certificate: pick yes or no",
      "Achievement & Extracurricular — Remarks: please write a remark",
      "Why This Program?: pick 1 to 5",
      "Why This Program — Remarks: please write a remark",
      "Drop year: pick yes or no",
      "If a drop year was taken, what was the previous year's JEE Mains percentile?: please answer (write N/A if it does not apply)",
      "JEE Mains Percentile: enter a number or tick N/A",
      "JEE Mains Maths Percentile: enter a number or tick N/A",
      "JEE Mains Percentile (Expected): enter a number or tick N/A",
      "Any Other Exam Score (if any): please answer (write N/A if it does not apply)",
      "Class 12th Percentage: enter a number or tick N/A",
      "Class 11th Percentage: enter a number or tick N/A",
      "Class 10th Percentage: enter a number or tick N/A",
      "Financial Capability: pick High, Medium or Low",
      "Why? (Financial explanation): please answer",
      "Why should Vedam accept your application and what could the batch learn from you?: please answer",
    ]);
  });
  it("numbers: 0 to 100 with up to 2 decimals", () => {
    for (const [value, ok] of [["0", true], ["100", true], ["99.99", true], ["100.01", false], ["101", false], ["-1", false],
      ["9.999", false], ["abc", false], ["1e2", false], [" 75 ", true]] as const) {
      const f = filled(); f.numbers.class12_pct = { value, na: false };
      const r = buildInterviewRequest("APP-1", f);
      expect(r.ok, value).toBe(ok);
      if (!r.ok) expect(r.errors).toEqual(["Class 12th Percentage: a number from 0 to 100"]);
    }
  });
  it("marks must be whole numbers from 1 to 5", () => {
    for (const v of [0, 6, 2.5]) {
      const f = filled(); f.parts.logic = v;
      const r = buildInterviewRequest("APP-1", f);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors).toEqual(["Guesstimate & Logical Reasoning: pick 1 to 5"]);
    }
  });
  it("blank remarks and over-long answers are refused", () => {
    const f = filled(); f.remarks.passion = "   "; f.remarks.logic = "x".repeat(REMARK_MAX + 1); f.text.why_accept = "y".repeat(TEXT_QUESTIONS.why_accept.max + 1);
    const r = buildInterviewRequest("APP-1", f);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual([
      `Logical & Reasoning — Remarks: ${REMARK_MAX} characters at most`,
      "Passion & Motivation for CS — Remarks: please write a remark",
      `Why should Vedam accept your application and what could the batch learn from you?: ${TEXT_QUESTIONS.why_accept.max} characters at most`,
    ]);
  });
});
