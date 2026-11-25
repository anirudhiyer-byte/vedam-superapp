/**
 * VSAT Phase 5 · Buckets per VSAT and campus (0188, owner's review 24 Nov 2026 + decisions 25 Nov).
 *
 * Sir: per VSAT and campus, set the ARPU (average revenue per user = programme fee − scholarship, averaged over the
 * students); the system arranges the buckets so it is met, and an admin can change anything by hand; "jitna bucket, utna
 * range" — every bucket is 5 %; lock a VSAT so later changes do not touch it; tiles show Pune, Gurugram and overall ARPU
 * as the buckets change. The database does every calculation (vsat_buckets_*); these helpers shape the screen only.
 */
import type { Band, CampusKey } from "./settings";

export type ArpuResult = {
  campus: CampusKey;
  students: number;
  arpu: number | null;
  avg_pct: number | null;
  categories: { category: number | null; students: number; avg_pct: number | null }[];
};

export type BucketsCampus = {
  campus: CampusKey;
  fee: number | null;
  own: boolean;
  bands: Band[];
  default_bands: Band[];
  arpu_target: number | null;
  locked_at: string | null;
  locked_by: string | null;
  current: ArpuResult;
};

export type BucketsData = {
  can_edit: boolean;
  vsats: { id: string; label: string; exam_date: string | null }[];
  exam_date_id: string | null;
  campuses: BucketsCampus[];
  overall: { students: number; arpu: number | null } | null;
};

export type SuggestResult = {
  reached: boolean;
  shift: number;
  bands: Band[];
  arpu_target: number;
  suggested?: ArpuResult;
  current: ArpuResult;
};

export const BUCKET_POINTS = 5;

/** Sir's rule (checked again by the database when saving): a band's award range is 5 points per bucket after the first. */
export function ruleErrors(bands: Band[]): string[] {
  return bands
    .filter((b) => Number.isFinite(b.steps) && Number.isFinite(b.min_award) && Number.isFinite(b.max_award)
      && b.max_award - b.min_award !== BUCKET_POINTS * (b.steps - 1))
    .map((b) => `Category ${b.category} has ${b.steps} bucket${b.steps === 1 ? "" : "s"}, so its award range must be ${BUCKET_POINTS * (b.steps - 1)} points (5 each): ${b.min_award}–${b.min_award + BUCKET_POINTS * (b.steps - 1)}%.`);
}

/** Overall ARPU = the students-weighted average of the campuses (as the database does). */
export function overallArpu(rows: { students: number; arpu: number | null }[]): number | null {
  const used = rows.filter((r) => r.students > 0 && r.arpu !== null && Number.isFinite(r.arpu));
  const n = used.reduce((s, r) => s + r.students, 0);
  if (!n) return null;
  return Math.round(used.reduce((s, r) => s + r.students * (r.arpu as number), 0) / n);
}

/** The target is typed in lakh, as sir says it ("12.5"); returns rupees, or null when it is not a usable number. */
export function parseLakh(text: string): number | null {
  const t = text.trim().replace(/,/g, "");
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(t)) return null;
  const v = Math.round(Number(t) * 100_000);
  return v > 0 && v <= 100_000_000 ? v : null;
}

/** 1250000 → "12.5" (the target box). */
export function toLakhText(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "";
  return String(Math.round((v / 100_000) * 100) / 100);
}

/** Two sets are the same buckets (to know whether the screen has unsaved changes). */
export function sameBands(a: Band[], b: Band[]): boolean {
  if (a.length !== b.length) return false;
  const key = (x: Band) => [x.category, x.min_score, x.max_score, x.steps, x.min_award, x.max_award].map(Number).join("|");
  const sa = [...a].sort((x, y) => x.category - y.category).map(key);
  const sb = [...b].sort((x, y) => x.category - y.category).map(key);
  return sa.every((k, i) => k === sb[i]);
}
