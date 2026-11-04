"use client";

import { Icon, LinkText, StatusPill } from "../../ui/primitives";
import { CHANNEL_LABEL } from "../../lib/mock-api";
import { ListNames } from "./list-names";
import type { Channel, CommLogRow } from "../../lib/types";

export const CHANNEL_ICON: Record<Channel, "mail" | "whatsapp" | "sms" | "amplify"> = { email: "mail", whatsapp: "whatsapp", sms: "sms", amplify: "amplify" };
export const CHANNEL_COLOR: Record<Channel, string> = { email: "text-muted", whatsapp: "text-[#25D366]", sms: "text-[#60a5fa]", amplify: "text-accent" };
export const num = (n: number | null) => (n === null ? "—" : n.toLocaleString("en-IN"));

/** Status pill plus (when the job has something to explain) an ⓘ button that opens the Status Detail modal. */
export function StatusCell({ row, onInfo }: { row: CommLogRow; onInfo: (r: CommLogRow) => void }) {
  return (
    <span className="inline-flex items-center gap-1">
      <StatusPill status={row.status} />
      {row.statusInfo && (
        <button type="button" onClick={() => onInfo(row)} aria-label={`Status details for ${row.jobId}`}
          className="grid h-11 w-11 place-items-center rounded-lg text-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-soft sm:h-8 sm:w-8">
          <Icon name="info" className="h-3.5 w-3.5" />
        </button>
      )}
    </span>
  );
}

/** Phone view of one job: the same facts as the table row, stacked. */
export function CommCard({ row, onDetail, onPreview, onInfo }: {
  row: CommLogRow; onDetail: (r: CommLogRow) => void; onPreview: (r: CommLogRow) => void; onInfo: (r: CommLogRow) => void;
}) {
  const fact = (label: string, value: string) => (
    <div className="min-w-0"><dt className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</dt><dd className="mt-0.5 break-words font-body text-xs text-foreground">{value || "—"}</dd></div>
  );
  return (
    <>
      <h2 className="flex min-w-0 items-center gap-2 font-display text-base font-bold text-heading">
        <span title={CHANNEL_LABEL[row.channel]}><Icon name={CHANNEL_ICON[row.channel]} className={`h-4 w-4 ${CHANNEL_COLOR[row.channel]}`} /></span>
        <span data-job={row.id}><LinkText touch onClick={() => onDetail(row)}>{row.jobId}</LinkText></span>
      </h2>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 font-body text-xs text-muted">
        <LinkText touch onClick={() => onPreview(row)}>{`Preview ${CHANNEL_LABEL[row.channel]}`}</LinkText>
        <span>{row.template === "-" ? "No template" : row.template}</span>
      </div>
      <div className="mt-1"><StatusCell row={row} onInfo={onInfo} /></div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
        {fact("Started", row.startDate)}
        {fact("Sent by", row.sentBy ?? "")}
        {fact("Targeted", num(row.targeted))}
        {fact("Delivered", num(row.delivered))}
        {fact("Form", row.form ?? "")}
        {fact("Campaign", row.campaignName && row.campaignName !== "NA" ? row.campaignName : "")}
        {fact("Automation ID", row.automationId)}
        {fact("Retry", row.retry ?? "")}
      </dl>
      <div className="mt-2 flex items-center gap-1 font-body text-xs text-muted">List <ListNames row={row} /></div>
    </>
  );
}
