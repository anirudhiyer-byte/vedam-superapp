"use client";

import { LinkText, StatusPill } from "../../ui/primitives";
import type { Column } from "../../ui/data-table";
import { TagChips } from "./tag-chips";
import type { AutomationRow } from "../../lib/types";

const pill = (v: string) => <span className="rounded-md bg-surface-warm px-2 py-1 font-mono text-[11px] font-semibold text-accent">{v}</span>;

/** Table columns for Manage Automation. The name opens the Edit Automation page. `lastRun` (live data, Slice 8) adds a Last Run column. */
export function automationColumns({ onOpen, lastRun = false }: { onOpen: (r: AutomationRow) => void; lastRun?: boolean }): Column<AutomationRow>[] {
  const cols: Column<AutomationRow>[] = [
    { id: "id", header: "ID", sortable: true, width: 80, cell: (r) => <span className="font-mono text-xs">{r.id}</span> },
    { id: "name", header: "Automation Name", sortable: true, sticky: true, width: 240, cell: (r) => <LinkText touch onClick={() => onOpen(r)}>{r.name}</LinkText> },
    { id: "module", header: "Module", cell: (r) => pill(r.module) },
    { id: "list", header: "List", cell: (r) => pill(r.list) },
    { id: "trigger", header: "Trigger", sortable: true, cell: (r) => r.trigger },
    { id: "status", header: "Status", sortable: true, cell: (r) => <StatusPill status={r.status} /> },
    { id: "createdOn", header: "Created On", sortable: true, cell: (r) => r.createdOn },
    { id: "createdBy", header: "Created By", sortable: true, cell: (r) => r.createdBy },
    { id: "startDate", header: "Start Date", sortable: true, cell: (r) => r.startDate },
    { id: "endDate", header: "End Date", sortable: true, cell: (r) => r.endDate },
    { id: "tags", header: "Tags", cell: (r) => <TagChips tags={r.tags} max={2} /> },
  ];
  if (lastRun) cols.splice(6, 0, { id: "lastRun", header: "Last Run", width: 230, cell: (r) => r.lastRun ?? "-" });
  return cols;
}
