"use client";

import { Icon, LinkText, FOCUS_RING } from "../../ui/primitives";
import type { ListRow } from "../../lib/types";

/** Phone view of one list: the same facts as the table row, stacked. */
export function ListCard({ row, onTags, onCount }: { row: ListRow; onTags: (r: ListRow) => void; onCount: (r: ListRow) => void }) {
  const stat = (label: string, n: number | null) => (
    <div className="min-w-0">
      <dt className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 font-body text-sm font-semibold text-heading">
        {n === null ? <span className="whitespace-nowrap"><LinkText touch onClick={() => onCount(row)}>View Count</LinkText></span> : <span className="tabular-nums">{n.toLocaleString("en-IN")}</span>}
      </dd>
    </div>
  );
  return (
    <>
      <div className="flex items-center gap-1">
        <h2 className="min-w-0 truncate font-display text-base font-bold text-heading">{row.name}</h2>
        {row.id !== "-" && !row.live && (
          <button type="button" onClick={() => onTags(row)}
            aria-label={`Tags for ${row.name}: ${row.tags?.length ?? 0}. Add or remove tags`}
            className={`-my-1.5 grid h-11 w-11 shrink-0 place-items-center rounded-lg hover:bg-surface-warm ${FOCUS_RING} ${row.tagged ? "text-accent-soft" : "text-muted"}`}>
            <Icon name="tag" className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <p className="font-mono text-[11px] text-muted">{row.id === "-" ? "System list" : `ID ${row.live ? row.id.slice(0, 8) : row.id}`} · {row.origin}</p>
      <dl className="mt-3 grid grid-cols-3 gap-2">
        {stat("Leads", row.totalLeads)}
        {stat("Emails", row.uniqueEmail)}
        {stat("Mobiles", row.uniqueMobile)}
      </dl>
      <p className="mt-3 font-body text-xs text-muted">
        Owner <span className="font-semibold text-foreground">{row.owner}</span>
        {row.createdOn !== "-" && <> · {row.createdOn}</>}
        {row.createdBy !== "-" && <> · by {row.createdBy}</>}
      </p>
    </>
  );
}
