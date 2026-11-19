import { describe, expect, it } from "vitest";
import { classifyCampus } from "./campus";

// Same rule as the CRM (morning-report + cohort classifyCampus) and as SQL public.growth__campus (migration 0116).
describe("classifyCampus", () => {
  it.each([
    ["Sushant University — Gurugram", "GGN"],
    ["Gurugram (Sushant University)", "GGN"],
    ["GGN", "GGN"],
    ["ggn campus", "GGN"],
    ["Ajeenkya DY Patil University — Pune", "PUNE"],
    ["ADYPU", "PUNE"],
    ["pune", "PUNE"],
  ])("%s → %s", (raw, want) => {
    expect(classifyCampus(raw)).toBe(want);
  });

  it("Gurugram wins when both names appear (CRM checks Gurugram first)", () => {
    expect(classifyCampus("Pune or Gurugram")).toBe("GGN");
  });

  it.each([[null], [undefined], [""], ["   "], ["Delhi"], ["QA-TEST"]])("%s → OTHER", (raw) => {
    expect(classifyCampus(raw as string | null | undefined)).toBe("OTHER");
  });

  it("does not throw on odd input", () => {
    expect(classifyCampus(123 as unknown as string)).toBe("OTHER");
    expect(classifyCampus("<script>pune</script>")).toBe("PUNE");
  });
});
