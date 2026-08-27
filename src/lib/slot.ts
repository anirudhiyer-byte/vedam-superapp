/** Slot-answer parsing for the invite pass (ported from vedam-events). */

const MONTHS: Record<string, string> = {
  jan: "JANUARY", january: "JANUARY", feb: "FEBRUARY", february: "FEBRUARY",
  mar: "MARCH", march: "MARCH", apr: "APRIL", april: "APRIL", may: "MAY",
  jun: "JUNE", june: "JUNE", jul: "JULY", july: "JULY", aug: "AUGUST", august: "AUGUST",
  sep: "SEPTEMBER", sept: "SEPTEMBER", september: "SEPTEMBER", oct: "OCTOBER", october: "OCTOBER",
  nov: "NOVEMBER", november: "NOVEMBER", dec: "DECEMBER", december: "DECEMBER",
};
const WEEKDAYS: Record<string, string> = {
  sun: "SUN", sunday: "SUN", mon: "MON", monday: "MON", tue: "TUE", tues: "TUE", tuesday: "TUE",
  wed: "WED", weds: "WED", wednesday: "WED", thu: "THU", thur: "THU", thurs: "THU", thursday: "THU",
  fri: "FRI", friday: "FRI", sat: "SAT", saturday: "SAT",
};

export function parseTime(str?: string): number | null {
  if (!str) return null;
  const m = String(str).match(/(\d{1,2})(?::(\d{2}))?\s*([AaPp])\.?[Mm]?\.?/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const ap = m[3].toLowerCase();
  if (h < 1 || h > 12 || min < 0 || min > 59) return null;
  if (ap === "p" && h !== 12) h += 12;
  if (ap === "a" && h === 12) h = 0;
  return h * 60 + min;
}

export function fmtParts(mins: number | null): { time: string; ampm: string } {
  if (mins == null) return { time: "", ampm: "" };
  const h24 = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const ampm = h24 >= 12 ? "PM" : "AM";
  let h12 = h24 % 12;
  if (h12 === 0) h12 = 12;
  return { time: `${h12}:${String(m).padStart(2, "0")}`, ampm };
}

function findTimes(raw?: string): number[] {
  const out: number[] = [];
  if (!raw) return out;
  const re = /(\d{1,2})(?::(\d{2}))?\s*([AaPp])\.?[Mm]?\.?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const mins = parseTime(m[0]);
    if (mins != null) out.push(mins);
    if (out.length >= 2) break;
  }
  return out;
}

export function extractDate(raw?: string): { day: string | null; month: string | null; weekday: string | null } | null {
  if (!raw) return null;
  const lower = String(raw).toLowerCase();
  let month: string | null = null;
  const mMatch = lower.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/);
  if (mMatch) month = MONTHS[mMatch[1]] || null;
  let weekday: string | null = null;
  const wMatch = lower.match(/\b(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:s|nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)\b/);
  if (wMatch) weekday = WEEKDAYS[wMatch[1]] || null;
  let day: string | null = null;
  if (month) {
    const dMatch = lower.match(/\b(\d{1,2})(?:st|nd|rd|th)?\b(?=[^0-9:]*\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))/)
      || lower.match(/(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
    if (dMatch) { const d = parseInt(dMatch[1], 10); if (d >= 1 && d <= 31) day = String(d); }
  }
  if (!month && !weekday && !day) return null;
  return { day, month, weekday };
}

export function parseSlot(raw?: string) {
  const times = findTimes(raw);
  return { raw: raw || "", startMin: times[0] ?? null, endMin: times[1] ?? null, date: extractDate(raw) };
}

/** Pull the "Preferred Time & Slot" answer out of an answers object. */
export function extractSlotFromAnswers(answers: Record<string, unknown> | null | undefined): string {
  if (!answers || typeof answers !== "object") return "";
  const val = (v: unknown) => (Array.isArray(v) ? v.join(", ") : v == null ? "" : String(v));
  const KNOWN = ["slot", "preferred_time_slot", "preferred_slot", "preferred_time", "time_slot"];
  for (const k of KNOWN) if (answers[k]) return val(answers[k]);
  for (const k of Object.keys(answers)) {
    const lk = k.toLowerCase();
    if (lk.includes("slot") || (lk.includes("preferred") && lk.includes("time"))) if (answers[k]) return val(answers[k]);
  }
  return "";
}
