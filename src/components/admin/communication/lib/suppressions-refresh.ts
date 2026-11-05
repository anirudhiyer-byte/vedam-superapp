/**
 * Suppressions · after a successful Add or Remove, the list AND the tab counts are fetched again together.
 *
 * Why: the counts used to follow only the table's `refreshedAt`, which is shown to the minute ("04:15 pm").
 * A change inside the same minute left that value unchanged, so a badge could keep an old number until Refresh.
 * Every successful write now also bumps a counter that the counts request depends on.
 */
export function refreshAfterWrite(opts: {
  /** fetch the current list again */
  reload: () => void;
  /** bump the counter the tab counts depend on */
  bumpCounts: () => void;
  /** when the save moved the screen to another tab, that tab change already fetches its list */
  switchTab?: () => void;
}): void {
  if (opts.switchTab) opts.switchTab();
  else opts.reload();
  opts.bumpCounts();
}
