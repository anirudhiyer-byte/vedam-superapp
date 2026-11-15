/**
 * Static list from a CSV (Slice 3b) · reads the file IN THE BROWSER and keeps only the phone and e-mail cells.
 * Every other column is dropped here and never leaves the browser. The raw file is not kept or sent anywhere.
 *
 * Rules: .csv only, at most 1 MB, at most 5000 data rows, the first non-blank row is the header and must have a
 * phone/mobile/WhatsApp column and/or an e-mail column. Handles a UTF-8 BOM, CRLF / LF / CR line ends and
 * RFC 4180 quotes ("a, b", "say ""hi""", line breaks inside quotes). Blank lines are skipped. Duplicates are kept
 * here; the server counts them. Cells are never evaluated or shown on screen, so formula-like cells ("=cmd")
 * are just text that will not match anyone.
 */

export const CSV_MAX_BYTES = 1024 * 1024;
export const CSV_MAX_ROWS = 5000;
const PHONE_MAX = 64;
const EMAIL_MAX = 254;

export type IdRow = { p?: string; e?: string };
export type CsvParsed = {
  rows: IdRow[];
  phoneColumn: string | null;
  emailColumn: string | null;
  /** columns in the file that are dropped in the browser (everything except phone / e-mail) */
  droppedColumns: number;
  blankLines: number;
};
export type CsvResult = { ok: true; data: CsvParsed } | { ok: false; error: string };

/** checks done before the file is even read */
export function checkCsvFile(f: { name: string; size: number }): string | null {
  if (!/\.csv$/i.test(f.name.trim())) return "Choose a .csv file.";
  if (f.size <= 0) return "The file is empty.";
  if (f.size > CSV_MAX_BYTES) return "The file is larger than 1 MB. Split it into smaller files.";
  return null;
}

/** bytes → text. null = not a text file (has NUL bytes). UTF-8 first; Excel "ANSI" CSVs fall back to Windows-1252. */
export function decodeCsvBytes(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** RFC 4180 tokenizer. Returns the records, or an error for a quote that is never closed. */
export function tokenizeCsv(text: string): string[][] | { error: string } {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const out: string[][] = [];
  let rec: string[] = [];
  let cell = "";
  let quoted = false;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { cell += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      cell += ch; i++; continue;
    }
    if (ch === '"' && cell === "") { quoted = true; i++; continue; }
    if (ch === ",") { rec.push(cell); cell = ""; i++; continue; }
    if (ch === "\r" || ch === "\n") {
      rec.push(cell); out.push(rec); rec = []; cell = "";
      i += ch === "\r" && s[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    cell += ch; i++;
  }
  if (quoted) return { error: "A quoted value in the file is never closed. Check the file and try again." };
  if (cell !== "" || rec.length > 0) { rec.push(cell); out.push(rec); }
  return out;
}

const norm = (h: string) => h.trim().toLowerCase().replace(/[\s_.\-()]+/g, "");
const NOT_THE_PERSON = /parent|father|mother|guardian|alternate|alt|secondary|office|emergency/;
const PHONE_EXACT = ["phone", "mobile", "whatsapp", "phonenumber", "mobilenumber", "whatsappnumber", "phoneno", "mobileno", "contactnumber", "contactno", "contact", "cell"];
const EMAIL_EXACT = ["email", "emailid", "emailaddress", "mail", "mailid"];
/** the person's own column: an exact common name first, else the first header containing the word (never a parent's / alternate one) */
function findColumn(header: string[], exact: string[], word: RegExp): number {
  const n = header.map(norm);
  const i = n.findIndex((h) => exact.includes(h));
  return i >= 0 ? i : n.findIndex((h) => word.test(h) && !NOT_THE_PERSON.test(h));
}
const clean = (v: string | undefined, max: number): string => {
  const t = (v ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return t.length > max ? "" : t;   // too long can never be a phone / e-mail: sent as empty, counted as invalid
};

/** text → only the phone / e-mail cells of each data row */
export function parseCsvText(text: string): CsvResult {
  const tok = tokenizeCsv(text);
  if (!Array.isArray(tok)) return { ok: false, error: tok.error };
  let blankLines = 0;
  const recs = tok.filter((r) => {
    const blank = r.every((c) => c.trim() === "");
    if (blank) blankLines++;
    return !blank;
  });
  if (recs.length === 0) return { ok: false, error: "The file has no rows." };
  const header = recs[0];
  const phoneIdx = findColumn(header, PHONE_EXACT, /phone|mobile|whatsapp/);
  const emailIdx = findColumn(header, EMAIL_EXACT, /e?mail/);
  if (phoneIdx < 0 && emailIdx < 0) {
    return { ok: false, error: "Row 1 must be a header with a phone (or mobile) column and/or an e-mail column." };
  }
  const data = recs.slice(1);
  if (data.length === 0) return { ok: false, error: "There are no rows under the header." };
  if (data.length > CSV_MAX_ROWS) return { ok: false, error: `The file has ${data.length.toLocaleString("en-IN")} rows. Upload at most ${CSV_MAX_ROWS.toLocaleString("en-IN")} at a time.` };
  const rows = data.map((r) => {
    const out: IdRow = {};
    const p = phoneIdx >= 0 ? clean(r[phoneIdx], PHONE_MAX) : "";
    const e = emailIdx >= 0 ? clean(r[emailIdx], EMAIL_MAX) : "";
    if (p) out.p = p;
    if (e) out.e = e;
    return out;
  });
  return {
    ok: true,
    data: {
      rows,
      phoneColumn: phoneIdx >= 0 ? header[phoneIdx].trim() : null,
      emailColumn: emailIdx >= 0 ? header[emailIdx].trim() : null,
      droppedColumns: header.length - (phoneIdx >= 0 ? 1 : 0) - (emailIdx >= 0 ? 1 : 0),
      blankLines,
    },
  };
}

/** a whole file: checks, decoding and parsing in one step (the raw bytes are not kept) */
export async function readCsvFile(f: File): Promise<CsvResult> {
  const issue = checkCsvFile(f);
  if (issue) return { ok: false, error: issue };
  const text = decodeCsvBytes(new Uint8Array(await f.arrayBuffer()));
  if (text === null) return { ok: false, error: "This does not look like a CSV text file." };
  return parseCsvText(text);
}
