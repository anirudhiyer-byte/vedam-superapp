"use client";

import { Menu, Icon, FOCUS_RING, type MenuItem } from "../../ui/primitives";
import type { AutomationRow } from "../../lib/types";

export type AutomationActions = {
  edit: (r: AutomationRow) => void;
  performance: (r: AutomationRow) => void;
  copy: (r: AutomationRow) => void;
  pause: (r: AutomationRow) => void;
  resume: (r: AutomationRow) => void;
  deactivate: (r: AutomationRow) => void;
  remove: (r: AutomationRow) => void;
};

/**
 * The gear menu on each row. What it offers depends on the status:
 *  Active   → Edit, View Performance, De-activate, Copy, Pause
 *  Stopped  → Edit, View Performance, Copy, Delete
 *  Pause    → Edit, View Performance, Resume, De-activate, Copy
 *  Draft    → Edit, Copy, Delete (it has never run, so there is nothing to measure)
 *  Completed→ Edit, View Performance, Copy, Delete
 */
export function RowMenu({ row, act }: { row: AutomationRow; act: AutomationActions }) {
  const edit: MenuItem = { label: "Edit Automation", icon: "pencil", onClick: () => act.edit(row) };
  const perf: MenuItem = { label: "View Performance", icon: "chart", onClick: () => act.performance(row) };
  const copy: MenuItem = { label: "Copy Automation", icon: "copy", onClick: () => act.copy(row) };
  const del: MenuItem = { label: "Delete", icon: "trash", danger: true, onClick: () => act.remove(row) };
  const stop: MenuItem = { label: "De-activate", icon: "close", onClick: () => act.deactivate(row) };
  const items: MenuItem[] =
    row.status === "Active" ? [edit, perf, stop, copy, { label: "Pause Automation", icon: "clock", onClick: () => act.pause(row) }]
    : row.status === "Pause" ? [edit, perf, { label: "Resume Automation", icon: "check", onClick: () => act.resume(row) }, stop, copy]
    : row.status === "Draft" ? [edit, copy, del]
    : [edit, perf, copy, del];
  return (
    <Menu align="right" touch items={items}
      trigger={(open, toggle) => (
        <button type="button" onClick={toggle} aria-label={`Actions for ${row.name}`} data-row-actions={row.id} aria-haspopup="menu" aria-expanded={open}
          className={`grid h-11 w-11 place-items-center rounded-lg transition-colors sm:h-8 sm:w-8 ${FOCUS_RING} ${open ? "bg-surface-warm text-accent" : "text-muted hover:bg-surface-warm hover:text-foreground"}`}>
          <Icon name="gear" className="h-4 w-4" />
        </button>
      )} />
  );
}
