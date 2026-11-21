import { describe, expect, it } from "vitest";
import {
  cellText, cpaSpend, cplSpend, duplicateOf, filterRows, fmtInr2, kpis, mapRecords, mappingErrors, nextSort, parseCsv, serialsOf,
  sortRows, tgError, totalSpend, valueOf, type TgColumn, type TgRow,
} from "./telegram";

const row = (o: Partial<TgRow> & { id: string }): TgRow => ({
  influencer_name: "Chan A", utm_link: "https://t.me/a?utm_source=tg&utm_medium=m&utm_campaign=c", campaign_id: "c1", used_in: "VSAT-10",
  cpl: 0, cpa: 0, extra: {}, created_at: "", updated_at: "", deleted_at: null, utm_key: null,
  leads: 0, payments: 0, enrollments: 0, leads_all: 0, payments_all: 0, enrollments_all: 0, ...o,
});
const col = (key: string, type: TgColumn["type"] = "text", label = key): TgColumn => ({ key, label, type, required: false, standard: true, hidden: false });
const COLS: TgColumn[] = [
  col("serial_no", "computed", "Serial No"), { ...col("influencer_name", "text", "Influencer Name"), required: true },
  { ...col("utm_link", "url", "UTM Link"), required: true }, { ...col("used_in", "select", "Used In"), required: true },
  col("cpl", "number", "CPL"), col("cpa", "number", "CPA"), col("cpl_spend", "computed", "CPL Spend"), col("leads", "computed", "Leads"),
];

describe("spend", () => {
  it("CPL × in-window leads, CPA × in-window payments, total = both", () => {
    const r = row({ id: "1", cpl: 100, cpa: 2000, leads: 30, payments: 4, leads_all: 90 });
    expect(cplSpend(r)).toBe(3000);
    expect(cpaSpend(r)).toBe(8000);
    expect(totalSpend(r)).toBe(11000);
    expect(valueOf(r, "total_spend")).toBe(11000);
  });
  it("empty CPL / CPA shows as nothing (CRM —)", () => {
    expect(valueOf(row({ id: "1" }), "cpl")).toBeNull();
    expect(cellText(COLS[4], 1500)).toBe("1,500");   // CRM table: plain number, no ₹ (KPI cards keep ₹)
    expect(cellText(COLS[4], null)).toBe("—");
  });
});

describe("KPI cards", () => {
  const rows = [
    row({ id: "1", influencer_name: "Chan A", cpl: 100, cpa: 1000, leads: 10, payments: 2, leads_all: 20, payments_all: 3, enrollments_all: 1 }),
    row({ id: "2", influencer_name: " chan a ", campaign_id: "c2", used_in: "VSAT-11", cpl: 50, leads: 10, payments: 0, leads_all: 20, payments_all: 3 }),
    row({ id: "3", influencer_name: "Chan B", utm_link: "https://t.me/b", leads: 0 }),
  ];
  it("unique influencers / UTMs, overall CPL / CPA, spend, in-window + all-time", () => {
    const k = kpis(rows);
    expect(k).toMatchObject({ influencers: 2, utms: 2, cplSpend: 1500, cpaSpend: 2000, totalSpend: 3500, leads: 20, leadsAll: 40,
      payments: 2, paymentsAll: 6, enrollmentsAll: 1 });
    expect(k.overallCpl).toBe(75);
    expect(k.overallCpa).toBe(1000);
  });
  it("no leads → CPL 0, shown as ₹0.00", () => {
    expect(kpis([]).overallCpl).toBe(0);
    expect(fmtInr2(0)).toBe("₹0.00");
    expect(fmtInr2(1234.5)).toBe("₹1,234.50");
  });
});

describe("search and sort", () => {
  const rows = [row({ id: "1", influencer_name: "Alpha", leads: 3 }), row({ id: "2", influencer_name: "Beta", used_in: "VSAT-11", leads: 9 })];
  const ser = serialsOf(rows);
  it("searches influencer, UTM, VSAT, serial; comma = any", () => {
    expect(filterRows(rows, "vsat-11", ser).map((r) => r.id)).toEqual(["2"]);
    expect(filterRows(rows, "alpha, beta", ser)).toHaveLength(2);
    expect(filterRows(rows, "2", ser).map((r) => r.id)).toEqual(["2"]);
  });
  it("sort cycles asc → desc → none", () => {
    let s = nextSort(null, "leads");
    expect(sortRows(rows, s, ser).map((r) => r.id)).toEqual(["1", "2"]);
    s = nextSort(s, "leads");
    expect(sortRows(rows, s, ser).map((r) => r.id)).toEqual(["2", "1"]);
    expect(nextSort(s, "leads")).toBeNull();
  });
});

describe("duplicate (same UTM in the same VSAT)", () => {
  const rows = [row({ id: "1" })];
  it("same VSAT (by id or name) + same UTM key is a duplicate; another VSAT is not", () => {
    const other = "https://x.org/p?utm_campaign=C&utm_medium=M&utm_source=TG";
    expect(duplicateOf(rows, other, "c1")?.id).toBe("1");
    expect(duplicateOf(rows, other, "vsat-10")?.id).toBe("1");
    expect(duplicateOf(rows, other, "c2")).toBeNull();
    expect(duplicateOf(rows, other, "c1", "1")).toBeNull();
  });
});

describe("CSV upload", () => {
  it("guesses columns from headers and aliases", () => {
    const p = parseCsv("Influencer,UTM,VSAT,CPL,Notes\nA,https://t.me/a,VSAT-10,100,x\n", COLS);
    expect(p.ok && p.data.guess).toEqual(["influencer_name", "utm_link", "used_in", "cpl", ""]);
  });
  it("needs UTM Link and Used In mapped; add mode needs the required ones", () => {
    expect(mappingErrors(["influencer_name", "utm_link"], COLS, "upsert")).toEqual(["Map a header to Used In (the VSAT, needed for every row)."]);
    expect(mappingErrors(["utm_link", "used_in"], COLS, "add")).toEqual(["Map a header to Influencer Name (required)."]);
    expect(mappingErrors(["utm_link", "used_in", "influencer_name"], COLS, "add")).toEqual([]);
  });
  it("maps records, leaving empty cells out", () => {
    const p = parseCsv("UTM,VSAT,CPL\nhttps://t.me/a,VSAT-10,\n", COLS);
    if (!p.ok) throw new Error(p.error);
    expect(mapRecords(p.data, ["utm_link", "used_in", "cpl"], COLS)).toEqual([{ utm_link: "https://t.me/a", used_in: "VSAT-10" }]);
  });
});

describe("errors", () => {
  it("turns database codes into sentences", () => {
    expect(tgError("REQUIRED: used_in")).toBe("Used In is required.");
    expect(tgError("BAD_VALUE: used_in")).toMatch(/one of the VSAT campaigns/);
    expect(tgError("DUPLICATE_UTM", "Chan A")).toMatch(/already listed for this VSAT \(Chan A\)/);
    expect(tgError("FORBIDDEN")).toBe("Only admins can use the Telegram screens.");
  });
});
