"use client";

import { Icon, LinkText, Dash } from "../../ui/primitives";
import type { Column } from "../../ui/data-table";
import { CHANNEL_LABEL } from "../../lib/mock-api";
import { CHANNEL_COLOR, CHANNEL_ICON, StatusCell, num } from "./comm-card";
import { ListNames } from "./list-names";
import type { CommLogRow } from "../../lib/types";

const na = (v?: string) => (!v || v === "NA" ? <span className="font-mono text-xs text-muted">NA</span> : v);

/** Table columns for Manage Communication Logs. Order follows Meritto; the row gear is added by the table at the end. */
export function commColumns(h: { onDetail: (r: CommLogRow) => void; onPreview: (r: CommLogRow) => void; onInfo: (r: CommLogRow) => void; onAutomation: (id: string) => void }): Column<CommLogRow>[] {
  return [
    { id: "channel", header: "", width: 48, cell: (r) => <span title={CHANNEL_LABEL[r.channel]}><Icon name={CHANNEL_ICON[r.channel]} className={`h-4 w-4 ${CHANNEL_COLOR[r.channel]}`} /></span> },
    { id: "jobId", header: "Job ID", sortable: true, sticky: true, width: 150, cell: (r) => <span data-job={r.id}><LinkText touch onClick={() => h.onDetail(r)}>{r.jobId}</LinkText></span> },
    {
      id: "preview", header: "Preview", width: 230,
      cell: (r) => (
        <span className="inline-flex items-baseline gap-2">
          <LinkText touch onClick={() => h.onPreview(r)}>{r.preview}</LinkText>
          {r.previewNote && <span className="truncate font-mono text-[11px] text-muted">{r.previewNote}</span>}
        </span>
      ),
    },
    { id: "template", header: "Template Name", sortable: true, cell: (r) => (r.template === "-" ? <Dash /> : r.template) },
    { id: "status", header: "Status", sortable: true, cell: (r) => <StatusCell row={r} onInfo={h.onInfo} /> },
    { id: "startDate", header: "Communication Start Date", sortable: true, cell: (r) => r.startDate },
    { id: "listName", header: "List Name", cell: (r) => <ListNames row={r} /> },
    { id: "segmentName", header: "Segment Name", cell: (r) => (r.segmentName === "-" ? <Dash /> : r.segmentName) },
    { id: "targeted", header: "Targeted Audience", align: "right", sortable: true, cell: (r) => <span className="tabular-nums">{num(r.targeted)}</span> },
    {
      id: "delivered", header: "Delivered To", align: "right", sortable: true,
      cell: (r) => (
        <span className="inline-flex items-center justify-end gap-1.5">
          <span className="tabular-nums">{num(r.delivered)}</span>
          {r.delivered !== null && r.targeted > 0 && <span className="font-mono text-[10px] text-muted">{Math.round((r.delivered / r.targeted) * 100)}%</span>}
        </span>
      ),
    },
    { id: "automationId", header: "Automation ID", cell: (r) => (r.automationId === "NA" ? na("NA") : <LinkText touch onClick={() => h.onAutomation(r.automationId)}>{r.automationId}</LinkText>) },
    { id: "campaignName", header: "Campaign Name", cell: (r) => na(r.campaignName) },
    { id: "campaignType", header: "Campaign Type", cell: (r) => na(r.campaignType) },
    { id: "form", header: "Form", cell: (r) => r.form ?? <Dash /> },
    { id: "sentBy", header: "Sent By/Scheduled By", sortable: true, cell: (r) => r.sentBy ?? <Dash /> },
    { id: "retry", header: "Retry", cell: (r) => r.retry ?? <Dash /> },
    { id: "waAction", header: "Whatsapp Action", cell: () => <Dash /> },
  ];
}
