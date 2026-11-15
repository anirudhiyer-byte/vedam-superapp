/** Slice 3b · CSV parser (browser side). Fake data only. */
import { describe, expect, it } from "vitest";
import { CSV_MAX_BYTES, checkCsvFile, decodeCsvBytes, parseCsvText, readCsvFile, tokenizeCsv } from "./csv-identifiers";

const ok = (text: string) => {
  const r = parseCsvText(text);
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.data;
};
const err = (text: string) => {
  const r = parseCsvText(text);
  if (r.ok) throw new Error("expected an error");
  return r.error;
};

describe("file checks (before reading)", () => {
  it("only .csv, not empty, at most 1 MB", () => {
    expect(checkCsvFile({ name: "leads.csv", size: 10 })).toBeNull();
    expect(checkCsvFile({ name: "LEADS.CSV", size: 10 })).toBeNull();
    expect(checkCsvFile({ name: "leads.xlsx", size: 10 })).toMatch(/\.csv/);
    expect(checkCsvFile({ name: "leads.csv.exe", size: 10 })).toMatch(/\.csv/);
    expect(checkCsvFile({ name: "leads", size: 10 })).toMatch(/\.csv/);
    expect(checkCsvFile({ name: "leads.csv", size: 0 })).toMatch(/empty/);
    expect(checkCsvFile({ name: "leads.csv", size: CSV_MAX_BYTES })).toBeNull();
    expect(checkCsvFile({ name: "leads.csv", size: CSV_MAX_BYTES + 1 })).toMatch(/1 MB/);
  });
  it("binary content is refused; UTF-8 and Windows-1252 text are read", () => {
    expect(decodeCsvBytes(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]))).toBeNull();   // a zip/xlsx header
    expect(decodeCsvBytes(new TextEncoder().encode("phone\n9000000301"))).toBe("phone\n9000000301");
    expect(decodeCsvBytes(new Uint8Array([0x6e, 0x61, 0x6d, 0x65, 0x0a, 0x4a, 0xfc, 0x72, 0x67]))).toBe("name\nJürg");   // ANSI "ü"
  });
  it("readCsvFile: wrong extension / binary / good file", async () => {
    expect(await readCsvFile(new File(["phone\n9000000301"], "x.txt"))).toEqual({ ok: false, error: "Choose a .csv file." });
    expect((await readCsvFile(new File([new Uint8Array([1, 0, 2])], "x.csv"))).ok).toBe(false);
    const r = await readCsvFile(new File(["phone\n9000000301\n"], "x.csv"));
    expect(r).toEqual({ ok: true, data: { rows: [{ p: "9000000301" }], phoneColumn: "phone", emailColumn: null, droppedColumns: 0, blankLines: 0 } });
  });
});

describe("tokenizer (RFC 4180)", () => {
  it("BOM, CRLF / LF / CR, quotes with commas, escaped quotes and line breaks", () => {
    expect(tokenizeCsv("﻿a,b\r\n1,2\n3,4\r5,6")).toEqual([["a", "b"], ["1", "2"], ["3", "4"], ["5", "6"]]);
    expect(tokenizeCsv('name,email\n"Zz, Test","zz@example.invalid"\n"say ""hi""","line1\nline2"')).toEqual([
      ["name", "email"], ["Zz, Test", "zz@example.invalid"], ['say "hi"', "line1\nline2"]]);
    expect(tokenizeCsv("a,b,\n")).toEqual([["a", "b", ""]]);
  });
  it("a quote that is never closed is an error", () => {
    expect(tokenizeCsv('a\n"open')).toEqual({ error: expect.stringMatching(/never closed/) });
    expect(err('phone\n"9000000301')).toMatch(/never closed/);
  });
});

describe("parse: only phone / e-mail cells leave the parser", () => {
  it("keeps phone + e-mail, drops every other column (they never leave the browser)", () => {
    const d = ok("Name,Mobile Number,City,Email ID,Notes\nZz One,+91 90000 00301,Pune,zz-1@example.invalid,anything\n");
    expect(d.rows).toEqual([{ p: "+91 90000 00301", e: "zz-1@example.invalid" }]);
    expect(d.phoneColumn).toBe("Mobile Number");
    expect(d.emailColumn).toBe("Email ID");
    expect(d.droppedColumns).toBe(3);
    expect(JSON.stringify(d.rows)).not.toMatch(/Zz One|Pune|anything/);
  });
  it("phone only, or e-mail only, is enough", () => {
    expect(ok("phone\n9000000301").rows).toEqual([{ p: "9000000301" }]);
    expect(ok("E-mail\nzz@example.invalid").rows).toEqual([{ e: "zz@example.invalid" }]);
  });
  it("picks the person's own column, never a parent's / alternate one", () => {
    const d = ok("Parent Phone,Father Mobile,Student WhatsApp,Parent Email,Email\n9000000391,9000000392,9000000301,zz-p@example.invalid,zz-s@example.invalid");
    expect(d.phoneColumn).toBe("Student WhatsApp");
    expect(d.emailColumn).toBe("Email");
    expect(d.rows).toEqual([{ p: "9000000301", e: "zz-s@example.invalid" }]);
  });
  it("no phone / e-mail header → clear error", () => {
    expect(err("name,city\nZz,Pune")).toMatch(/header/);
    expect(err("9000000301,zz@example.invalid\n9000000302,zz2@example.invalid")).toMatch(/header/);
  });
  it("empty file / only blank lines / header without rows", () => {
    expect(err("")).toMatch(/no rows/);
    expect(err("\n\n \n")).toMatch(/no rows/);
    expect(err("phone,email\n")).toMatch(/no rows under the header/);
  });
  it("blank lines are skipped and counted; rows with empty cells are kept (counted as invalid by the server)", () => {
    const d = ok("phone,email\n\n9000000301,\n , \n,zz@example.invalid\n\n");
    expect(d.blankLines).toBe(3);
    expect(d.rows).toEqual([{ p: "9000000301" }, { e: "zz@example.invalid" }]);
  });
  it("5000 rows are fine, 5001 are refused", () => {
    const body = (k: number) => Array.from({ length: k }, (_, i) => `9${String(i).padStart(9, "0")}`).join("\n");
    expect(ok(`phone\n${body(5000)}`).rows).toHaveLength(5000);
    expect(err(`phone\n${body(5001)}`)).toMatch(/5,001 rows.*at most 5,000/);
  });
  it("duplicates are kept here (the server counts them)", () => {
    expect(ok("phone\n9000000301\n9000000301\n+91 90000 00301").rows).toHaveLength(3);
  });
  it("bad phones / e-mails pass through as text (the server marks them invalid)", () => {
    expect(ok("phone,email\n12345,not-an-email").rows).toEqual([{ p: "12345", e: "not-an-email" }]);
  });
  it("formula-like cells are plain text: never evaluated, never shown, just sent as a value that matches nobody", () => {
    expect(ok('phone,email\n=cmd|\' /C calc\'!A0,"=HYPERLINK(""http://x"")"').rows).toEqual([{ p: "=cmd|' /C calc'!A0", e: '=HYPERLINK("http://x")' }]);
  });
  it("unicode in other columns is dropped; control characters are removed; over-long cells are sent empty", () => {
    const d = ok(`नाम,phone,email\nज़ेड,90000\u000000301,${"a".repeat(250)}@x.in\n名前,${"9".repeat(65)},zz\u0007@example.invalid`);
    expect(d.rows).toEqual([{ p: "9000000301" }, { e: "zz@example.invalid" }]);
  });
});
