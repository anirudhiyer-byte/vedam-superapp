import { describe, expect, it } from "vitest";
import {
  cellText, consError, csvCell, duplicateOf, filterRows, importErrorLines, kpis, mapRecords, mappingErrors, nextSort, parseCsv,
  serialsOf, sortRows, toCsv, totalEnrollments, totalSpend, utmKey, valueOf, type ConsColumn, type ConsRow,
} from "./consultants";

// fake data only
const row = (p: Partial<ConsRow> & { id: string }): ConsRow => ({
  consultant_name: "ZZ One", utm_link: `https://x.invalid/?utm_source=zz${p.id}`, city: null, bdm: null, category: "Associated with Sunstone",
  coupon_code: null, slab_hit: null, enrollment_spend: 0, slab_spend: 0, extra: {}, created_at: "2090-01-01T00:00:00Z", updated_at: "2090-01-01T00:00:00Z",
  deleted_at: null, utm_key: null, leads: 0, apps_utm: 0, apps_coupon: 0, enr_utm: 0, enr_coupon: 0, ...p,
});
const col = (key: string, label: string, type: ConsColumn["type"] = "text", extra: Partial<ConsColumn> = {}): ConsColumn =>
  ({ key, label, type, required: false, standard: true, hidden: false, ...extra });
const STD: ConsColumn[] = [
  col("serial_no", "Serial No", "computed"), col("consultant_name", "Consultant Name", "text", { required: true }), col("utm_link", "UTM Link", "url", { required: true }),
  col("city", "City"), col("bdm", "BDM"), col("category", "Category", "select", { required: true }), col("coupon_code", "Coupon Code"),
  col("slab_hit", "Sunstone Slab Hit", "select"), col("leads", "Leads", "computed"), col("enr_total", "Total Enrollments", "computed"),
  col("enrollment_spend", "Enrollment Spend", "number"), col("slab_spend", "Sunstone Slab Spend", "number"), col("total_spend", "Total Spend", "computed"),
];
const CUSTOM = col("x_zz_payout", "ZZ Payout", "number", { standard: false });

describe("serial, totals, values", () => {
  const rows = [row({ id: "a" }), row({ id: "b" }), row({ id: "c" })];
  it("Serial No is 1…N in list order", () => {
    expect([...serialsOf(rows).values()]).toEqual([1, 2, 3]);
  });
  it("totals add the two parts", () => {
    const r = row({ id: "a", enr_utm: 2, enr_coupon: 3, enrollment_spend: 1000, slab_spend: 250.5 });
    expect(totalEnrollments(r)).toBe(5);
    expect(totalSpend(r)).toBe(1250.5);
    expect(valueOf(r, "enr_total")).toBe(5);
    expect(valueOf(r, "total_spend")).toBe(1250.5);
  });
  it("added columns read from extra; empty is null", () => {
    expect(valueOf(row({ id: "a", extra: { x_zz_payout: "1200" } }), "x_zz_payout")).toBe("1200");
    expect(valueOf(row({ id: "a", extra: { x_zz_payout: "" } }), "x_zz_payout")).toBeNull();
    expect(valueOf(row({ id: "a" }), "city")).toBeNull();
  });
});

describe("filters (CRM rules)", () => {
  const rows = [
    row({ id: "a", consultant_name: "ZZ Alpha", coupon_code: "ZZA10", slab_hit: "Yes" }),
    row({ id: "b", consultant_name: "ZZ Beta", category: "Not Associated with Sunstone", city: "ZZ Town", slab_hit: "No" }),
    row({ id: "c", consultant_name: "ZZ Gamma", bdm: "ZZ Bdm" }),
  ];
  const s = serialsOf(rows);
  const ids = (q: string, category = "", slab: "" | "yes" | "no" = "") => filterRows(rows, { q, category, slab }, s).map((r) => r.id);
  it("comma means any of the terms, case-insensitive, over name / UTM / coupon / category / city / BDM / serial", () => {
    expect(ids("alpha, zz town")).toEqual(["a", "b"]);
    expect(ids("za10")).toEqual(["a"]);
    expect(ids("zz bdm")).toEqual(["c"]);
    expect(ids("utm_source=zzb")).toEqual(["b"]);
    expect(ids("not associated")).toEqual(["b"]);
    expect(ids("3")).toContain("c");
    expect(ids(" , ")).toEqual(["a", "b", "c"]);
  });
  it("category and slab filters are exact", () => {
    expect(ids("", "Not Associated with Sunstone")).toEqual(["b"]);
    expect(ids("", "", "yes")).toEqual(["a"]);
    expect(ids("", "", "no")).toEqual(["b"]);   // empty slab is neither Yes nor No
  });
});

describe("sort", () => {
  it("cycles none → asc → desc → none", () => {
    let s = nextSort(null, "leads");
    expect(s).toEqual({ key: "leads", dir: "asc" });
    s = nextSort(s, "leads");
    expect(s).toEqual({ key: "leads", dir: "desc" });
    expect(nextSort(s, "leads")).toBeNull();
    expect(nextSort(s, "city")).toEqual({ key: "city", dir: "asc" });
  });
  it("numbers sort as numbers, empty cells always last", () => {
    const rows = [row({ id: "a", leads: 10, city: null }), row({ id: "b", leads: 9, city: "ZZ B" }), row({ id: "c", leads: 100, city: "zz a" })];
    const s = serialsOf(rows);
    expect(sortRows(rows, { key: "leads", dir: "asc" }, s).map((r) => r.id)).toEqual(["b", "a", "c"]);
    expect(sortRows(rows, { key: "city", dir: "asc" }, s).map((r) => r.id)).toEqual(["c", "b", "a"]);
    expect(sortRows(rows, { key: "city", dir: "desc" }, s).map((r) => r.id)).toEqual(["b", "c", "a"]);
    expect(sortRows(rows, null, s)).toBe(rows);
  });
});

describe("KPI cards (CRM rules)", () => {
  it("counts consultants once by name; first non-empty category; active = leads or applications", () => {
    const k = kpis([
      row({ id: "a", consultant_name: "ZZ Alpha", leads: 3, apps_utm: 1, enr_utm: 1, enrollment_spend: 1000 }),
      row({ id: "b", consultant_name: "zz alpha ", category: "Not Associated with Sunstone", apps_coupon: 2, enr_coupon: 1, slab_spend: 500 }),
      row({ id: "c", consultant_name: "ZZ Beta", category: "Not Associated with Sunstone" }),
      row({ id: "d", consultant_name: "ZZ Gamma", apps_coupon: 1 }),
    ]);
    expect(k.consultants).toBe(3);
    expect([k.associated, k.notAssociated]).toEqual([2, 1]);
    expect(k.active).toBe(2);
    expect([k.leads, k.apps, k.appsUtm, k.appsCoupon]).toEqual([3, 4, 1, 3]);
    expect([k.enr, k.enrUtm, k.enrCoupon]).toEqual([2, 1, 1]);
    expect([k.enrollmentSpend, k.slabSpend, k.totalSpend]).toEqual([1000, 500, 1500]);
  });
  it("empty list → zeros", () => {
    expect(kpis([]).consultants).toBe(0);
    expect(kpis([]).totalSpend).toBe(0);
  });
});

describe("cell text", () => {
  it("money in ₹, numbers en-IN, empty as a dash", () => {
    expect(cellText(STD[10], 150000)).toBe("₹1,50,000");
    expect(cellText(STD[8], 123456)).toBe("1,23,456");
    expect(cellText(STD[3], null)).toBe("—");
    expect(cellText(col("x_d", "D", "date", { standard: false }), "2090-03-05")).toMatch(/05.*Mar.*2090/);
  });
});

describe("UTM key (same rule as growth__utm_key)", () => {
  it("source/medium/campaign, any order, any case, %20 and + as spaces", () => {
    const a = utmKey("https://a.invalid/?utm_source=ZZCONS&utm_medium=zzmed&utm_campaign=zz%20one");
    expect(a).toBe("zzcons/zzmed/zz one");
    expect(utmKey("https://b.invalid/x?utm_campaign=zz+one&utm_medium=ZZMED&utm_source=zzcons&x=1")).toBe(a);
    expect(utmKey("https://b.invalid/?ref=1")).toBeNull();
    expect(utmKey("https://b.invalid/?utm_source=zzonly")).toBe("zzonly");
  });
  it("duplicate check: same link text or same UTM; the row itself does not count", () => {
    const rows = [row({ id: "a", consultant_name: "ZZ Alpha", utm_link: "https://a.invalid/?utm_source=zz1&utm_medium=m" })];
    expect(duplicateOf(rows, " HTTPS://A.INVALID/?utm_source=zz1&utm_medium=m ")?.consultant_name).toBe("ZZ Alpha");
    expect(duplicateOf(rows, "https://other.invalid/?utm_medium=M&utm_source=ZZ1")?.id).toBe("a");
    expect(duplicateOf(rows, "https://a.invalid/?utm_source=zz1&utm_medium=m", "a")).toBeNull();
    expect(duplicateOf(rows, "https://a.invalid/?utm_source=zz2")).toBeNull();
    expect(duplicateOf(rows, "  ")).toBeNull();
  });
});

describe("CSV export", () => {
  it("quotes commas / quotes / new lines and defuses spreadsheet formulas", () => {
    expect(csvCell('ZZ "A", B')).toBe('"ZZ ""A"", B"');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("+91")).toBe("'+91");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell(-5)).toBe("-5");   // a real number stays a number
    expect(csvCell(null)).toBe("");
  });
  it("every column in order (hidden too), computed values, then values of removed columns", () => {
    const rows = [row({ id: "a", consultant_name: "ZZ, A", enr_utm: 1, enr_coupon: 2, enrollment_spend: 10, slab_spend: 5, extra: { x_old: "k", x_zz_payout: "7" } })];
    const cols = [...STD.slice(0, 2), { ...STD[9], hidden: true }, STD[12], CUSTOM];
    const lines = toCsv(rows, cols, serialsOf(rows)).split("\r\n");
    expect(lines[0]).toBe("Serial No,Consultant Name,Total Enrollments,Total Spend,ZZ Payout,x_old");
    expect(lines[1]).toBe('1,"ZZ, A",3,15,7,k');
  });
});

describe("CSV upload", () => {
  const cols = [...STD, CUSTOM];
  it("refuses a file without headers or rows", () => {
    expect(parseCsv("", cols)).toEqual({ ok: false, error: "No headers detected. First row must contain column names." });
    expect(parseCsv("Consultant Name,UTM Link\n", cols)).toEqual({ ok: false, error: "No data rows found." });
  });
  it("guesses columns by label and common names; computed / unknown / repeated headers are skipped", () => {
    const p = parseCsv("Consultant,UTM,Leads,Coupon Code,zz payout,Whatever,consultant name\nZZ A,https://x.invalid/?utm_source=zz,9,ZZC,1200,x,ZZ B\n", cols);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.data.guess).toEqual(["consultant_name", "utm_link", "", "coupon_code", "x_zz_payout", "", ""]);
    expect(mapRecords(p.data, p.data.guess, cols)).toEqual([
      { consultant_name: "ZZ A", utm_link: "https://x.invalid/?utm_source=zz", coupon_code: "ZZC", extra: { x_zz_payout: "1200" } },
    ]);
  });
  it("empty cells are left out (upsert keeps the old value)", () => {
    const p = parseCsv("UTM Link,City\nhttps://x.invalid/?utm_source=zz,\n", cols);
    if (!p.ok) throw new Error(p.error);
    expect(mapRecords(p.data, p.data.guess, cols)).toEqual([{ utm_link: "https://x.invalid/?utm_source=zz" }]);
  });
  it("mapping checks: UTM always, required columns when only adding, one header per column", () => {
    expect(mappingErrors(["utm_link"], cols, "upsert")).toEqual([]);
    expect(mappingErrors(["city"], cols, "upsert")).toContain("Map a header to UTM Link (it is needed for every row).");
    expect(mappingErrors(["utm_link"], cols, "add")).toEqual(["Map a header to Consultant Name (required).", "Map a header to Category (required)."]);
    expect(mappingErrors(["utm_link", "city", "city"], cols, "upsert")).toEqual(["City is chosen for 2 headers."]);
  });
  it("too many rows", () => {
    const text = "UTM Link\n" + Array.from({ length: 2001 }, (_, i) => `https://x.invalid/?utm_source=zz${i}`).join("\n");
    const p = parseCsv(text, cols);
    expect(p.ok).toBe(false);
  });
});

describe("error messages", () => {
  const labelOf = (k: string) => (k === "x_zz_payout" ? "ZZ Payout" : k === "city" ? "ZZ Town" : undefined);
  it("maps database codes to sentences", () => {
    expect(consError("REQUIRED: consultant_name")).toBe("Consultant Name is required.");
    expect(consError("REQUIRED: x_zz_payout", null, labelOf)).toBe("ZZ Payout is required.");
    expect(consError("BAD_VALUE: city", null, labelOf)).toBe("ZZ Town has a value that is not allowed.");
    expect(consError("BAD_VALUE: utm_link")).toMatch(/http:\/\/ or https:\/\//);
    expect(consError("DUPLICATE_UTM", "ZZ Alpha")).toBe("This UTM is already used by ZZ Alpha. Each UTM must be unique — duplicate UTMs cause double-counting.");
    expect(consError("DUPLICATE_UTM", null)).toMatch(/another row/);
    expect(consError("FORBIDDEN")).toMatch(/Only admins/);
    expect(consError("SYSTEM_COLUMN")).toBe("System column — it can only be renamed or hidden.");
    expect(consError("UNKNOWN_KEY: x_gone")).toMatch(/removed/);
    expect(consError("weird")).toBe("Something went wrong. Please try again.");
  });
  it("import errors name the file line (header = line 1)", () => {
    expect(importErrorLines('[{"row":1,"error":"BAD_VALUE: category"},{"row":3,"error":"DUPLICATE_UTM"}]', labelOf)).toEqual([
      'Line 2: Category must be "Associated with Sunstone" or "Not Associated with Sunstone".',
      "Line 4: This UTM is already used by another row. Each UTM must be unique — duplicate UTMs cause double-counting.",
    ]);
    expect(importErrorLines("not json", labelOf)).toEqual([]);
  });
});
