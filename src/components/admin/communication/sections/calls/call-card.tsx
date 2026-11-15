"use client";

import { Icon, LinkText } from "../../ui/primitives";
import type { CallRow } from "../../lib/types";

export const callStatusTone = (s: CallRow["callStatus"]) => (s === "Answered" ? "text-[#4ade80]" : "text-[#f87171]");

/** Phone view of one call: the same facts as the table row, stacked. */
export function CallCard({ row, onOpenLead }: { row: CallRow; onOpenLead: (r: CallRow) => void }) {
  const fact = (label: string, value: string) => (
    <div className="min-w-0">
      <dt className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</dt>
      <dd className="mt-0.5 break-words font-body text-xs text-foreground">{value || "—"}</dd>
    </div>
  );
  return (
    <>
      <h2 className="min-w-0 font-display text-base font-bold text-heading">
        {row.applicant ? <LinkText touch onClick={() => onOpenLead(row)}>{row.applicant}</LinkText> : <span className="text-muted">Unknown caller</span>}
      </h2>
      <p className="font-mono text-[11px] text-muted">{row.mobile}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-body text-xs">
        <span className="inline-flex items-center gap-1.5 text-foreground">
          <Icon name={row.callingType === "Incoming" ? "chevronLeft" : "chevronRight"} className="h-3 w-3 text-muted" />
          {row.callingType}
        </span>
        <span className={`font-semibold ${callStatusTone(row.callStatus)}`}>{row.callStatus}</span>
        <span className="tabular-nums text-muted">{row.durationSec} s</span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
        {fact("User", row.user)}
        {fact("Lead status", row.leadStatus)}
        {fact("Started", row.startTime)}
        {fact("Ended", row.endTime)}
      </dl>
    </>
  );
}
