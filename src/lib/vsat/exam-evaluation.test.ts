import { describe, expect, it } from "vitest";
import { SHEET_CUTS, checkRaise, defaultVsat, femaleMaleRatio, fmtNum, parseCut, sheetTables, type AnalysisCut } from "./exam-evaluation";

// vsat_exam_analysis answers for the "Test Result" sheet of VSAT 14 July (supabase/tests/vsat_exam_evaluation.test.sql proves
// the database gives exactly these for the sheet's 32 students)
const cut = (percentile: number, overall: [number, number, number], pune: [number, number, number], ggn: [number, number, number]): AnalysisCut => ({
  cutoff: {
    percentile, vps: null, total: overall[2], overall: { male: overall[0], female: overall[1], other: 0 },
    by_campus: { pune: { male: pune[0], female: pune[1], other: 0, total: pune[2] }, gurugram: { male: ggn[0], female: ggn[1], other: 0, total: ggn[2] } },
  },
});
const SHEET = { 35: cut(35, [21, 6, 27], [12, 4, 16], [9, 2, 11]), 60: cut(60, [20, 6, 26], [11, 4, 15], [9, 2, 11]), 65: cut(65, [20, 6, 26], [11, 4, 15], [9, 2, 11]) };

describe("Exam Evaluation: the Test Result sheet's three tables", () => {
  it("are Overall, ADYPU Pune and Gurugram Campus with 35 / 60 / 65 % columns, as in the sheet", () => {
    expect(SHEET_CUTS).toEqual([35, 60, 65]);
    const t = sheetTables(SHEET);
    expect(t.map((x) => x.title)).toEqual(["Overall", "ADYPU Pune", "Gurugram Campus"]);
    expect(t[0].rows).toEqual([
      { label: "Male", values: [21, 20, 20] }, { label: "Female", values: [6, 6, 6] }, { label: "Total", values: [27, 26, 26] },
    ]);
    expect(t[1].rows.map((r) => r.values)).toEqual([[12, 11, 11], [4, 4, 4], [16, 15, 15]]);
    expect(t[2].rows.map((r) => r.values)).toEqual([[9, 9, 9], [2, 2, 2], [11, 11, 11]]);
  });
  it("count 0 for a campus with nobody above the cut-off, or a cut-off not loaded yet", () => {
    const only = { 35: { cutoff: { percentile: 35, vps: null, total: 1, overall: { male: 1, female: 0, other: 0 }, by_campus: { pune: { male: 1, female: 0, other: 0, total: 1 } } } } };
    const t = sheetTables(only);
    expect(t[2].rows.map((r) => r.values)).toEqual([[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
    expect(t[0].rows[2].values).toEqual([1, 0, 0]);
  });
});

describe("Exam Evaluation: inputs", () => {
  it("takes an 'Other' cut-off only as a percentile from 0 to 100", () => {
    expect(parseCut("65")).toBe(65);
    expect(parseCut(" 62.5 ")).toBe(62.5);
    expect(parseCut("0")).toBe(0);
    expect(parseCut("100")).toBe(100);
    for (const bad of ["", "101", "-1", "abc", "6e1", "65%"]) expect(parseCut(bad)).toBeNull();
  });
  it("raises only to a VPS from 0 to 10 that reaches the cut-off, with a reason", () => {
    expect(checkRaise("7.4", 7.4, "manager ok")).toEqual({ ok: true, vps: 7.4 });
    expect(checkRaise("7.5", 7.4, "manager ok")).toEqual({ ok: true, vps: 7.5 });
    expect(checkRaise("7.39", 7.4, "manager ok")).toMatchObject({ ok: false, error: expect.stringContaining("at least the cut-off (7.4)") });
    for (const bad of ["", "10.5", "abc", "7.123", "-1"]) expect(checkRaise(bad, 0, "manager ok").ok).toBe(false);
    expect(checkRaise("8", 7.4, "ok")).toMatchObject({ ok: false, error: expect.stringContaining("reason") });
    expect(checkRaise("8", 7.4, "x".repeat(501)).ok).toBe(false);
  });
});

describe("Exam Evaluation: display", () => {
  it("shows numbers without trailing zeros and '—' when there is none", () => {
    expect(fmtNum(7.4)).toBe("7.4");
    expect(fmtNum(75.84375)).toBe("75.84");
    expect(fmtNum(26)).toBe("26");
    expect(fmtNum(null)).toBe("—");
  });
  it("shows female : male like the team reads it", () => {
    expect(femaleMaleRatio(24, 7)).toBe("1 : 3.4");
    expect(femaleMaleRatio(24, 0)).toBe("—");
  });
  it("opens on the latest VSAT whose exam day has come", () => {
    const list = [{ id: "c", exam_date: "2026-12-10" }, { id: "b", exam_date: "2026-11-25" }, { id: "a", exam_date: "2026-07-14" }];
    expect(defaultVsat(list, "2026-11-25")).toBe("b");
    expect(defaultVsat(list, "2026-01-01")).toBe("c");
    expect(defaultVsat([], "2026-11-25")).toBeNull();
  });
});
