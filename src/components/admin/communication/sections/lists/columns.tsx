"use client";

import { Icon, LinkText, Dash, FOCUS_RING } from "../../ui/primitives";
import type { Column } from "../../ui/data-table";
import type { ListRow } from "../../lib/types";

/** Table columns for Manage List. `onTags` opens the Add Tag drawer; `onCount` is the "View Count" link. */
export function listColumns({ onTags, onCount }: { onTags: (r: ListRow) => void; onCount: (r: ListRow) => void }): Column<ListRow>[] {
  const count = (r: ListRow, n: number | null) =>
    n === null ? <LinkText touch onClick={() => onCount(r)}>View Count</LinkText> : <span className="tabular-nums">{n.toLocaleString("en-IN")}</span>;
  return [
    { id: "id", header: "ID", sortable: true, width: 90, cell: (r) => (r.id === "-" ? <Dash /> : <span className="font-mono text-xs">{r.id}</span>) },
    {
      id: "name", header: "List Name", sortable: true, sticky: true, width: 200,
      cell: (r) => (
        <span className="inline-flex items-center gap-0.5">
          <span className="font-semibold text-heading">{r.name}</span>
          {r.id !== "-" && (
            <button type="button" onClick={() => onTags(r)}
              aria-label={`Tags for ${r.name}: ${r.tags?.length ?? 0}. Add or remove tags`} title={r.tagged ? `${r.tags?.length ?? 0} tag(s)` : "Add tag"}
              className={`grid h-11 w-11 place-items-center rounded-lg hover:bg-surface-warm sm:h-8 sm:w-8 ${FOCUS_RING} ${r.tagged ? "text-accent-soft" : "text-muted"}`}>
              <Icon name="tag" className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
      ),
    },
    { id: "origin", header: "List Origin", sortable: true, cell: (r) => r.origin },
    { id: "totalLeads", header: "Total Leads", align: "right", sortable: true, cell: (r) => count(r, r.totalLeads) },
    { id: "uniqueEmail", header: "Unique Email ID", align: "right", sortable: true, cell: (r) => count(r, r.uniqueEmail) },
    { id: "uniqueMobile", header: "Unique Mobile Number", align: "right", sortable: true, cell: (r) => count(r, r.uniqueMobile) },
    { id: "createdOn", header: "Created On", sortable: true, cell: (r) => (r.createdOn === "-" ? <Dash /> : r.createdOn) },
    { id: "createdBy", header: "Created By", sortable: true, cell: (r) => (r.createdBy === "-" ? <Dash /> : r.createdBy) },
    { id: "owner", header: "List Owner", sortable: true, cell: (r) => <span className="font-semibold">{r.owner}</span> },
  ];
}
