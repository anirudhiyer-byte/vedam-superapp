import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { columnsFor } from "./season";

// The database decides which columns a list returns, filters and sorts by (growth__season_cols in migration 0108).
// The screen shows the same keys. This test fails if one side changes without the other.
const sql = readFileSync(join(process.cwd(), "supabase/migrations/0108_growth_season_dashboard.sql"), "utf8");

function keysFor(kind: "leads" | "paid"): string[] {
  const fn = /create or replace function public\.growth__season_cols[\s\S]*?\$fn\$;/.exec(sql)?.[0] ?? "";
  const arrays = [...fn.matchAll(/array\[([\s\S]*?)\]/g)].map((m) => [...m[1].matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]));
  return kind === "leads" ? arrays[0] : arrays[1];
}

describe("season columns: screen and database agree", () => {
  it("leads", () => { expect(columnsFor("leads").map((c) => c.key)).toEqual(keysFor("leads")); });
  it("paid and enrolled", () => {
    expect(columnsFor("paid").map((c) => c.key)).toEqual(keysFor("paid"));
    expect(columnsFor("enrolled").map((c) => c.key)).toEqual(keysFor("paid"));
  });
});
