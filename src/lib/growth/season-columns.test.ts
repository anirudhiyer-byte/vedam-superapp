import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { columnsFor } from "./season";

// The database decides which columns a list returns, filters and sorts by (growth__season_cols; first in 0108, the
// CRM's columns since 0110). The screen shows the same keys. This test reads the NEWEST migration that defines the
// function, so it fails if one side changes without the other.
const dir = join(process.cwd(), "supabase/migrations");
const newest = readdirSync(dir).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort().reverse()
  .find((f) => /create or replace function public\.growth__season_cols/.test(readFileSync(join(dir, f), "utf8")));
const sql = newest ? readFileSync(join(dir, newest), "utf8") : "";

function keysFor(kind: "leads" | "paid"): string[] {
  const fn = /create or replace function public\.growth__season_cols[\s\S]*?\$fn\$;/.exec(sql)?.[0] ?? "";
  const arrays = [...fn.matchAll(/array\[([\s\S]*?)\]/g)].map((m) => [...m[1].matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]));
  return kind === "leads" ? arrays[0] : arrays[1];
}

describe("season columns: screen and database agree", () => {
  it("reads the newest migration that defines growth__season_cols", () => { expect(newest).toBe("0110_growth_season_crm_columns.sql"); });
  it("leads", () => { expect(columnsFor("leads").map((c) => c.key)).toEqual(keysFor("leads")); });
  it("paid and enrolled", () => {
    expect(columnsFor("paid").map((c) => c.key)).toEqual(keysFor("paid"));
    expect(columnsFor("enrolled").map((c) => c.key)).toEqual(keysFor("paid"));
  });
});
