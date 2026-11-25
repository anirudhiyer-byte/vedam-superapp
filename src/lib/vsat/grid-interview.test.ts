import { describe, expect, it } from "vitest";
import { DEFAULT_COLUMNS, INTERVIEW_SHEET_COLUMNS, VALUE_CHOICES, columnLabel, formatValue } from "./grid";

describe("Interview table = the Interview Responses sheet (0173)", () => {
  it("shows every answer, mark and remark as its own column, in the sheet's order, after the booking columns", () => {
    expect(DEFAULT_COLUMNS.intv).toEqual([...INTERVIEW_SHEET_COLUMNS]);
    expect(new Set(INTERVIEW_SHEET_COLUMNS).size).toBe(INTERVIEW_SHEET_COLUMNS.length);
    const sheet = INTERVIEW_SHEET_COLUMNS.slice(INTERVIEW_SHEET_COLUMNS.indexOf("interview_submitted_at"));
    expect(sheet).toEqual([
      "interview_submitted_at", "application_no",
      "iv_communication", "iv_communication_remarks", "iv_logic", "cheating_seen",
      "iv_passion", "iv_coding_talent", "iv_passion_remarks", "iv_achievements", "iv_cert_asked", "iv_why_program", "iv_why_program_remarks",
      "iv_drop_year", "iv_previous_jee", "iv_jee_pct", "iv_jee_maths_pct", "iv_expected_jee_pct", "iv_other_exams",
      "iv_class12_pct", "iv_class11_pct", "iv_class10_pct", "iv_financial", "iv_financial_reason", "interview_verdict", "iv_why_accept",
      "iv_logic_remarks", "iv_achievements_remarks", "interview_score", "interview_final_score",
    ]);
  });
  it("has no interviewer's verdict and no old calculated verdict any more", () => {
    expect(DEFAULT_COLUMNS.intv).not.toContain("interviewer_verdict");
    expect(DEFAULT_COLUMNS.intv).not.toContain("interview_calc_verdict");
  });
  it("names the new columns", () => {
    expect(columnLabel("interview_score")).toBe("Weighted score");
    expect(columnLabel("interview_final_score")).toBe("Final score (out of 20)");
    expect(columnLabel("interview_verdict")).toBe("Verdict");
    expect(columnLabel("iv_why_accept")).toBe("Why should Vedam accept you");
    for (const k of INTERVIEW_SHEET_COLUMNS.filter((x) => x.startsWith("iv_"))) {
      expect(columnLabel(k), k).not.toMatch(/^Iv /);  // a real name, not the humanised key
    }
  });
  it("shows the verdict in sir's words and filters on it", () => {
    expect(VALUE_CHOICES.interview_verdict.map((c) => c.label)).toEqual(["Selected", "Maybe", "Rejected"]);
    expect(formatValue("text", "interview_verdict", "not_selected")).toBe("Rejected");
    expect(formatValue("text", "interview_verdict", "selected")).toBe("Selected");
    expect(formatValue("text", "interview_verdict", null)).toBe("—");
    expect(formatValue("text", "iv_financial", "medium")).toBe("Medium");
  });
  it("a JEE percentile is not a percentage; class marks are", () => {
    expect(formatValue("num", "iv_jee_pct", 92.45)).toBe("92.45");
    expect(formatValue("num", "iv_jee_maths_pct", 90)).toBe("90");
    expect(formatValue("num", "iv_expected_jee_pct", 95)).toBe("95");
    expect(formatValue("num", "iv_class12_pct", 88)).toBe("88%");
    expect(formatValue("num", "iv_class10_pct", "100.00")).toBe("100%");
  });
});
