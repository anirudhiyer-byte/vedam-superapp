/**
 * VPS score — what the STUDENT sees, instead of their raw Wheebox marks.
 *
 * The raw exam result (overall + section marks) is admin-only and never shown to
 * the student. We map the student's VSAT percentile onto a 0–10 "VPS" scale with
 * a piecewise-linear curve whose anchor points the admin sets per VSAT cycle
 * (e.g. 50th percentile = 7.5, rising linearly to 100th = 10, and falling below).
 *
 * The curve is defined by anchor points {percentile, vps}. For a given percentile
 * we linearly interpolate between the two surrounding anchors, and clamp to the
 * nearest anchor beyond the ends. Output is clamped to [0, scaleMax] (default 10).
 */

export type VpsAnchor = { percentile: number; vps: number };

// Sensible default the admin can override per cycle.
export const DEFAULT_VPS_ANCHORS: VpsAnchor[] = [
  { percentile: 0, vps: 0 },
  { percentile: 50, vps: 7.5 },
  { percentile: 100, vps: 10 },
];

export function computeVps(percentile: number, anchors: VpsAnchor[] = DEFAULT_VPS_ANCHORS, scaleMax = 10): number {
  const clean = (anchors ?? [])
    .filter((a) => Number.isFinite(a?.percentile) && Number.isFinite(a?.vps))
    .sort((a, b) => a.percentile - b.percentile);
  if (clean.length === 0) return 0;

  const clamp = (v: number) => Math.max(0, Math.min(scaleMax, Math.round(v * 100) / 100));
  const p = Math.max(0, Math.min(100, Number(percentile)));

  if (p <= clean[0].percentile) return clamp(clean[0].vps);
  if (p >= clean[clean.length - 1].percentile) return clamp(clean[clean.length - 1].vps);

  for (let i = 0; i < clean.length - 1; i++) {
    const lo = clean[i], hi = clean[i + 1];
    if (p >= lo.percentile && p <= hi.percentile) {
      const span = hi.percentile - lo.percentile;
      const t = span === 0 ? 0 : (p - lo.percentile) / span;
      return clamp(lo.vps + t * (hi.vps - lo.vps));
    }
  }
  return clamp(clean[clean.length - 1].vps);
}
