"use client";

import { Menu, Icon, FOCUS_RING } from "../../ui/primitives";
import type { ListRow } from "../../lib/types";

export type RowActions = {
  importContact: (r: ListRow) => void;
  communicate: (r: ListRow) => void;
  edit: (r: ListRow) => void;
  changeOwner: (r: ListRow) => void;
  createSegment: (r: ListRow) => void;
  remove: (r: ListRow) => void;
  performance: (r: ListRow) => void;
};

/** The gear menu on each row. The LMS row is a system list, so edit / import / owner / delete are switched off for it.
 *  Live saved filters (Slice 3a): import, communicate, owner change and segments are not available yet. */
export function RowMenu({ row, act }: { row: ListRow; act: RowActions }) {
  const system = row.id === "-";
  const live = !!row.live;
  return (
    <Menu align="right" touch portal
      items={[
        { label: "Import Contact", icon: "upload", disabled: system || live, onClick: () => act.importContact(row) },
        { label: "Communicate", icon: "send", disabled: live, onClick: () => act.communicate(row) },
        { label: "Edit List", icon: "pencil", disabled: system, onClick: () => act.edit(row) },
        { label: "Change List Owner", icon: "userSwap", disabled: system || live, onClick: () => act.changeOwner(row) },
        { label: "Create Segment", icon: "segment", disabled: live, onClick: () => act.createSegment(row) },
        { label: "Delete", icon: "trash", danger: true, disabled: system, onClick: () => act.remove(row) },
        { label: "Communication Performance", icon: "chart", onClick: () => act.performance(row) },
      ]}
      trigger={(open, toggle) => (
        <button type="button" onClick={toggle} aria-label={`Actions for ${row.name}`} data-row-actions={row.id} aria-haspopup="menu" aria-expanded={open}
          className={`grid h-11 w-11 place-items-center rounded-lg transition-colors sm:h-8 sm:w-8 ${FOCUS_RING} ${open ? "bg-surface-warm text-accent" : "text-muted hover:bg-surface-warm hover:text-foreground"}`}>
          <Icon name="gear" className="h-4 w-4" />
        </button>
      )}
    />
  );
}
