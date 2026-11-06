/**
 * Communication Manager · CSV export cells (pure, unit-tested in csv-export.test.ts).
 *
 * Formula injection guard: a text cell that starts with "=", "+", "-", "@", a tab or a carriage return would be run
 * as a formula by Excel / Google Sheets, so it gets a leading ' (shown as plain text). Text with those characters in
 * the middle is left alone. Then the usual CSV quoting: a cell with a comma, a quote, a newline or a carriage return
 * is wrapped in quotes with inner quotes doubled (a raw CR would otherwise start a new row in a spreadsheet).
 * Numbers and null are written as they are ("-5" stays a number; null is empty).
 */
const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\n\r]/;

export function csvCell(v: string | number | null): string {
  if (v == null) return "";
  if (typeof v === "number") return String(v);
  const s = FORMULA_START.test(v) ? `'${v}` : v;
  return NEEDS_QUOTES.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** the whole file: header line + one line per row */
export const csvText = (headers: string[], rows: (string | number | null)[][]): string =>
  [headers.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\n");
