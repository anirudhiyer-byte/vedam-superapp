/**
 * Campus bucket of a campus text, the CRM's rule (morning-report and cohort `classifyCampus`).
 * SQL twin: public.growth__campus (migration 0116). Keep both the same; both have tests.
 */
export type Campus = "GGN" | "PUNE" | "OTHER";

export function classifyCampus(raw: string | null | undefined): Campus {
  if (typeof raw !== "string" || !raw.trim()) return "OTHER";
  const c = raw.toLowerCase();
  if (c.includes("gurugram") || c.includes("sushant") || c.includes("ggn")) return "GGN";
  if (c.includes("pune") || c.includes("adypu")) return "PUNE";
  return "OTHER";
}
