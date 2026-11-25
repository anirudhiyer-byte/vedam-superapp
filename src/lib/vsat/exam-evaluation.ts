/**
 * Exam Evaluation (0172) — pure helpers for the page that copies the "Test Result" sheet's tables for one VSAT.
 * Every number comes from vsat_exam_analysis (one call per cut-off); this file only arranges them as the sheet does.
 */

/** The sheet's three cut-off columns: 35 %, 60 %, 65 % and above (not disqualified). */
export const SHEET_CUTS = [35, 60, 65] as const;

type Gender = { male: number; female: number; other: number };
/** The part of a vsat_exam_analysis answer the tables read. */
export type AnalysisCut = {
  cutoff: null | {
    percentile: number; vps: number | null; total: number; overall: Gender;
    by_campus: Partial<Record<"pune" | "gurugram" | "none", Gender & { total: number }>>;
  };
};

export type SheetTable = {
  key: "overall" | "pune" | "gurugram";
  /** the sheet's own titles */
  title: string;
  rows: { label: "Male" | "Female" | "Total"; values: number[] }[];
};

const TITLES: Record<SheetTable["key"], string> = { overall: "Overall", pune: "ADYPU Pune", gurugram: "Gurugram Campus" };

/**
 * The sheet's three tables (Overall, ADYPU Pune, Gurugram Campus), each with one column per cut-off, in the order of
 * `cuts`. A missing answer or a campus with nobody above the cut-off counts as 0, as in the sheet.
 */
export function sheetTables(byCut: Record<number, AnalysisCut | undefined>, cuts: readonly number[] = SHEET_CUTS): SheetTable[] {
  return (["overall", "pune", "gurugram"] as const).map((key) => {
    const cell = (c: number, part: "male" | "female" | "total"): number => {
      const cut = byCut[c]?.cutoff;
      if (!cut) return 0;
      if (key === "overall") return part === "total" ? cut.total : cut.overall[part];
      const g = cut.by_campus[key];
      return g ? g[part] : 0;
    };
    return {
      key, title: TITLES[key],
      rows: [
        { label: "Male", values: cuts.map((c) => cell(c, "male")) },
        { label: "Female", values: cuts.map((c) => cell(c, "female")) },
        { label: "Total", values: cuts.map((c) => cell(c, "total")) },
      ],
    };
  });
}

/** A percentile typed for "Other": a number from 0 to 100, else null. */
export function parseCut(text: string): number | null {
  const t = text.trim();
  if (!/^\d{1,3}(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return n >= 0 && n <= 100 ? n : null;
}

/** The VPS typed in Raise: a number from 0 to 10, at least the cut-off. Returns the number or the reason it is refused. */
export function checkRaise(vpsText: string, cutoff: number, reason: string): { ok: true; vps: number } | { ok: false; error: string } {
  const t = vpsText.trim();
  const v = Number(t);
  if (t === "" || !/^\d{1,2}(\.\d{1,2})?$/.test(t) || !Number.isFinite(v) || v < 0 || v > 10) return { ok: false, error: "VPS must be a number from 0 to 10 (up to 2 decimals)." };
  if (v < cutoff) return { ok: false, error: `The new VPS must be at least the cut-off (${fmtNum(cutoff)}).` };
  if (reason.trim().length < 3) return { ok: false, error: "Please add a reason (at least 3 characters)." };
  if (reason.trim().length > 500) return { ok: false, error: "The reason is too long (500 characters max)." };
  return { ok: true, vps: v };
}

/** "75.84", "7.4", "—" — trailing zeros dropped. */
export function fmtNum(n: number | null | undefined, digits = 2): string {
  return n === null || n === undefined || !Number.isFinite(Number(n)) ? "—" : Number(n).toFixed(digits).replace(/\.?0+$/, "");
}

/** Female : male as "1 : 3.4" (the team watches it); "—" when either is 0. */
export function femaleMaleRatio(male: number, female: number): string {
  return !male || !female ? "—" : `1 : ${fmtNum(male / female, 1)}`;
}

/** The VSAT to open first: the latest one whose exam day has come (list is newest first), else the newest. */
export function defaultVsat<T extends { id: string; exam_date: string }>(list: T[], todayIso: string): string | null {
  if (!list.length) return null;
  return (list.find((b) => b.exam_date <= todayIso) ?? list[0]).id;
}
