/**
 * Where a row menu opens (Manage List fix). A table wrapper with overflow-x:auto also clips vertically,
 * so a menu opened on one of the last rows was cut off at the bottom. With `flip`, the menu opens upward
 * when there is not enough room below inside the clipping box (and there is more room above).
 */
export type Box = { top: number; bottom: number };

export function opensUp(trigger: Box, clip: Box, menuHeight: number, gap = 6): boolean {
  const below = clip.bottom - trigger.bottom - gap;
  const above = trigger.top - clip.top - gap;
  return below < menuHeight && above > below;
}

/** the visible part of the nearest ancestor that clips (overflow not "visible"), limited to the window */
export function clipBox(from: HTMLElement): Box {
  let top = 0;
  let bottom = window.innerHeight;
  for (let el = from.parentElement; el; el = el.parentElement) {
    const s = window.getComputedStyle(el);
    if (s.overflowX !== "visible" || s.overflowY !== "visible") {
      const r = el.getBoundingClientRect();
      top = Math.max(top, r.top);
      bottom = Math.min(bottom, r.bottom);
      break;
    }
  }
  return { top, bottom };
}
