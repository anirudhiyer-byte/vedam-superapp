/** CSV export cells: formula injection guard (a leading ' for = + - @ tab CR) + the usual CSV quoting. */
import { describe, expect, it } from "vitest";
import { csvCell, csvText } from "./csv-export";

describe("csvCell: formula injection", () => {
  it.each([
    ["=cmd|' /C calc'!A0", "'=cmd|' /C calc'!A0"],
    ["+1+1", "'+1+1"],
    ["-2+3", "'-2+3"],
    ["@SUM(1)", "'@SUM(1)"],
    ["\t=1", "'\t=1"],
  ])("%j → %j", (input, out) => { expect(csvCell(input)).toBe(out); });
  it("a leading CR gets the ' and is quoted (a raw CR would start a new row in a spreadsheet)", () => {
    expect(csvCell("\r=1")).toBe("\"'\r=1\"");
  });
  it("a CR in the middle is quoted, so '=1' after it cannot become a new cell at the start of a row", () => {
    expect(csvCell("ok\r=1")).toBe("\"ok\r=1\"");
  });
  it("a formula with quotes and commas: ' first, then quoted with doubled quotes", () => {
    expect(csvCell('=HYPERLINK("http://x.example","y")')).toBe("\"'=HYPERLINK(\"\"http://x.example\"\",\"\"y\"\")\"");
  });
  it("a formula with a newline: ' first, then quoted", () => {
    expect(csvCell("=1\n+2")).toBe("\"'=1\n+2\"");
  });
});

describe("csvCell: normal values are unchanged", () => {
  it("text with = / + / - / @ in the middle is not touched", () => {
    expect(csvCell("a=b")).toBe("a=b");
    expect(csvCell("Hello = world + 1 - 2 @ 3")).toBe("Hello = world + 1 - 2 @ 3");
    expect(csvCell("test.user01@example.com")).toBe("test.user01@example.com");
  });
  it("old quoting rules: comma, quote, newline", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell("x,=1")).toBe('"x,=1"');
  });
  it("numbers stay as numbers (even negative), null and empty string are empty", () => {
    expect(csvCell(42)).toBe("42");
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell(3.5)).toBe("3.5");
    expect(csvCell(null)).toBe("");
    expect(csvCell("")).toBe("");
  });
});

describe("csvText", () => {
  it("header + rows joined with commas and newlines, every cell guarded", () => {
    expect(csvText(["Name", "Note"], [["ZZ Test", "=1+1"], ["ZZ Two", null], [7, "a,b"]]))
      .toBe("Name,Note\nZZ Test,'=1+1\nZZ Two,\n7,\"a,b\"");
  });
  it("a header that looks like a formula is guarded too", () => {
    expect(csvText(["=Total"], [])).toBe("'=Total");
  });
});
