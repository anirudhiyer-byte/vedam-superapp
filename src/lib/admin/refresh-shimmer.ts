/**
 * Refresh shimmer · timing rule (pure, unit-tested). The effect itself is src/components/admin/ui/refresh-shimmer.tsx.
 *
 * After Refresh is pressed the cards stay blurred while the data loads, and for at least `minMs` in all, so one
 * full sweep of light always shows even when the data comes back at once.
 */

/** One sweep of light (1.05 s in the CSS) plus a little room. */
export const REFRESH_MIN_MS = 1100;

/** How long the effect still stays on: null while loading (wait), else the time left of the minimum (0 = end now). */
export function refreshHoldMs(startedAt: number, now: number, loading: boolean, minMs = REFRESH_MIN_MS): number | null {
  if (loading) return null;
  const elapsed = Math.max(0, now - startedAt);
  return Math.max(0, minMs - elapsed);
}
