"use client";

import { LinkText, StatusPill } from "../../ui/primitives";
import { TagChips } from "./tag-chips";
import type { AutomationRow } from "../../lib/types";

/** Phone view of one automation: the same facts as the table row, stacked. */
export function AutomationCard({ row, onOpen }: { row: AutomationRow; onOpen: (r: AutomationRow) => void }) {
  const fact = (label: string, value: string) => (
    <div className="min-w-0">
      <dt className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 break-words font-body text-xs text-foreground">{value}</dd>
    </div>
  );
  return (
    <>
      <h2 className="min-w-0 font-display text-base font-bold text-heading"><LinkText touch onClick={() => onOpen(row)}><span className="[overflow-wrap:anywhere]">{row.name}</span></LinkText></h2>
      <p className="font-mono text-[11px] text-muted">ID {row.id} · {row.module} · {row.list}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <StatusPill status={row.status} />
        <span className="font-body text-xs text-muted">{row.trigger}</span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
        {fact("Created", row.createdOn)}
        {fact("Created by", row.createdBy)}
        {fact("Starts", row.startDate)}
        {fact("Ends", row.endDate)}
        {row.lastRun !== undefined && <div className="col-span-2">{fact("Last run", row.lastRun)}</div>}
      </dl>
      {!!row.tags?.length && <div className="mt-3"><TagChips tags={row.tags} /></div>}
    </>
  );
}
