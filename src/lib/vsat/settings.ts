/**
 * VSAT settings screens (migration 0098) — pure helpers. The database checks every value again;
 * these only shape the forms so a save that the database would refuse is caught first.
 */

export type CampusKey = "pune" | "gurugram";
export type CampusSetting = { campus: CampusKey; programme_fee: number; offer_days: number; jee_floor_enabled: boolean; updated_at: string | null };
export type WeightSet = {
  effective_from: string; w_communication: number; w_logic: number; w_passion: number; w_achievements: number; w_why_program: number;
  note: string | null; editable: boolean;
};
export type Band = { category: number; min_score: number; max_score: number; steps: number; min_award: number; max_award: number };
export type BandRow = Band & { exam_date_id: string | null; campus: CampusKey };
export type Anchor = { percentile: number; vps: number };
export type VsatRow = {
  id: string; label: string; exam_date: string; enabled: boolean; vps_anchors: Anchor[] | null; cleared_vps_cutoff: number | null; students: number;
};
export type SettingsData = {
  editable_from: string; campuses: CampusSetting[]; weights: WeightSet[]; bands: BandRow[]; vsats: VsatRow[];
  default_vps_anchors: Anchor[]; default_cleared_vps_cutoff: number | null;
};

export const WEIGHT_KEYS = ["w_communication", "w_logic", "w_passion", "w_achievements", "w_why_program"] as const;
export type WeightKey = (typeof WEIGHT_KEYS)[number];
export const WEIGHT_LABEL: Record<WeightKey, string> = {
  w_communication: "Communication", w_logic: "Logical reasoning", w_passion: "Passion for CS",
  w_achievements: "Achievements", w_why_program: "Why this program",
};

/** Weights are stored as fractions (0.25) and edited as percentages (25). */
export const toPct = (f: number) => Math.round(f * 10000) / 100;
export const toFraction = (pct: number) => Math.round(pct * 100) / 10000;

/** Errors for a weight form (percentages): each 0–100, total 50–100. */
export function weightErrors(pcts: Record<WeightKey, number | null>): string[] {
  const out: string[] = [];
  let total = 0;
  for (const k of WEIGHT_KEYS) {
    const v = pcts[k];
    if (v === null || !Number.isFinite(v) || v < 0 || v > 100) out.push(`${WEIGHT_LABEL[k]}: 0 to 100`);
    else total += v;
  }
  if (!out.length && (total < 50 || total > 100)) out.push(`The weights add up to ${Math.round(total * 100) / 100}%. They must add up to between 50% and 100%.`);
  return out;
}

/**
 * Band editor model: each row only edits where it STARTS ("from"). Category 1 ends at 100, each
 * other row ends where the row above starts, and the last row always starts at 0 — so a saved set
 * can never have a gap or an overlap.
 */
export type BandDraft = { from: number; steps: number; min_award: number; max_award: number };

export function bandsToDraft(bands: Band[]): BandDraft[] {
  return [...bands].sort((a, b) => a.category - b.category)
    .map((b) => ({ from: b.min_score, steps: b.steps, min_award: b.min_award, max_award: b.max_award }));
}

export function draftToBands(draft: BandDraft[]): Band[] {
  return draft.map((d, i) => ({
    category: i + 1,
    min_score: i === draft.length - 1 ? 0 : d.from,
    max_score: i === 0 ? 100 : draft[i - 1].from,
    steps: d.steps, min_award: d.min_award, max_award: d.max_award,
  }));
}

export function bandErrors(draft: BandDraft[]): string[] {
  const out: string[] = [];
  if (draft.length === 0) return ["Add at least one category."];
  if (draft.length > 8) out.push("At most 8 categories.");
  draftToBands(draft).forEach((b) => {
    const c = `Category ${b.category}`;
    if (!(b.min_score >= 0 && b.max_score <= 100 && b.min_score < b.max_score)) out.push(`${c}: the score range must go from low to high (it is ${b.min_score} to ${b.max_score}).`);
    if (!Number.isInteger(b.steps) || b.steps < 1 || b.steps > 10) out.push(`${c}: steps must be a whole number from 1 to 10.`);
    if (!(b.min_award >= 0 && b.max_award <= 100 && b.min_award <= b.max_award)) out.push(`${c}: the award must go from low to high, 0 to 100.`);
  });
  return out;
}

/** The award steps a band offers (same formula as the database: evenly spaced, 2 decimals). */
export function awardSteps(b: Pick<Band, "steps" | "min_award" | "max_award">): number[] {
  if (b.steps <= 1) return [b.min_award];
  return Array.from({ length: b.steps }, (_, i) => Math.round((b.min_award + (i * (b.max_award - b.min_award)) / (b.steps - 1)) * 100) / 100);
}

/** VPS curve: 2–10 points, percentiles 0–100 rising, VPS 0–10 never falling. */
export function anchorErrors(a: Anchor[]): string[] {
  const out: string[] = [];
  if (a.length < 2 || a.length > 10) out.push("Use 2 to 10 points.");
  a.forEach((p, i) => {
    if (!(p.percentile >= 0 && p.percentile <= 100)) out.push(`Point ${i + 1}: percentile 0 to 100.`);
    if (!(p.vps >= 0 && p.vps <= 10)) out.push(`Point ${i + 1}: VPS 0 to 10.`);
    if (i > 0 && p.percentile <= a[i - 1].percentile) out.push(`Point ${i + 1}: the percentile must be higher than point ${i}.`);
    if (i > 0 && p.vps < a[i - 1].vps) out.push(`Point ${i + 1}: VPS must not be lower than point ${i}.`);
  });
  return out;
}

export const anchorsText = (a: Anchor[] | null | undefined) =>
  a && a.length ? a.map((p) => `${p.percentile}→${p.vps}`).join(", ") : "—";

export const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
