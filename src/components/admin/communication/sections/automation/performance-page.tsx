"use client";

import { PageHeader, SearchBox, Button, RefreshStamp, Icon, StatusPill, Dash, FilterChips } from "../../ui/primitives";
import { Breadcrumb } from "../../ui/breadcrumb";
import { DataTable, Pagination, useTableQuery, type Column } from "../../ui/data-table";
import { EmptyState } from "../../ui/states";
import { automationsApi, CHANNEL_LABEL } from "../../lib/mock-api";
import type { Channel, CommLogRow } from "../../lib/types";

const CH_ICON: Record<Channel, "mail" | "whatsapp" | "sms" | "amplify"> = { email: "mail", whatsapp: "whatsapp", sms: "sms", amplify: "amplify" };
const num = (n: number | null) => (n === null ? <Dash /> : <span className="tabular-nums">{n.toLocaleString("en-IN")}</span>);

const columns: Column<CommLogRow>[] = [
  { id: "jobId", header: "Job ID", sortable: true, sticky: true, width: 150, cell: (r) => <span className="font-mono text-xs">{r.jobId}</span> },
  { id: "channel", header: "Channel", cell: (r) => <span className="inline-flex items-center gap-1.5"><Icon name={CH_ICON[r.channel]} className="h-4 w-4 text-muted" />{CHANNEL_LABEL[r.channel]}</span> },
  { id: "template", header: "Template Name", sortable: true, cell: (r) => (r.template === "-" ? <Dash /> : r.template) },
  { id: "status", header: "Status", sortable: true, cell: (r) => <StatusPill status={r.status} /> },
  { id: "startDate", header: "Communication Start Date", sortable: true, cell: (r) => r.startDate },
  { id: "targeted", header: "Targeted Audience", align: "right", sortable: true, cell: (r) => num(r.targeted) },
  { id: "delivered", header: "Delivered To", align: "right", sortable: true, cell: (r) => num(r.delivered) },
];

function LogCard({ row }: { row: CommLogRow }) {
  return (
    <>
      <p className="font-display text-base font-bold text-heading">{row.jobId}</p>
      <p className="mt-0.5 flex items-center gap-1.5 font-body text-xs text-muted"><Icon name={CH_ICON[row.channel]} className="h-3.5 w-3.5" />{CHANNEL_LABEL[row.channel]} · {row.template === "-" ? "No template" : row.template}</p>
      <div className="mt-2"><StatusPill status={row.status} /></div>
      <dl className="mt-3 grid grid-cols-2 gap-2">
        <div><dt className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted">Targeted</dt><dd className="font-body text-sm font-semibold text-heading">{num(row.targeted)}</dd></div>
        <div><dt className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted">Delivered</dt><dd className="font-body text-sm font-semibold text-heading">{num(row.delivered)}</dd></div>
      </dl>
      <p className="mt-2 font-body text-xs text-muted">{row.startDate}</p>
    </>
  );
}

/**
 * VIEW PERFORMANCE — drill-down page (breadcrumb + Back): the communication jobs this automation has sent.
 * Reads the same data as Manage Communication Log, filtered to one automation.
 */
export function AutomationPerformance({ automation, from, onBack, onList, onOpenEditor }: {
  automation: { id: string; name: string }; from: "list" | "edit"; onBack: () => void; onList: () => void; onOpenEditor: () => void;
}) {
  const t = useTableQuery<CommLogRow>({ fetcher: (q) => automationsApi.logs(automation.id, q), pageSize: 10 });
  const backLabel = from === "edit" ? "Back to automation" : "Back to Manage Automations";
  return (
    <>
      <Breadcrumb items={[{ label: "Manage Automations", onClick: onList }, { label: automation.name, onClick: onOpenEditor }, { label: "Performance" }]} />
      <PageHeader
        title="Automation Performance"
        count={t.loading ? null : t.total}
        countLabel={t.total === 1 ? "Communication" : "Communications"}
        meta={<RefreshStamp touch at={t.refreshedAt} onRefresh={t.refresh} busy={t.loading} />}
        actions={
          <>
            <div className="w-full sm:w-auto"><SearchBox touch placeholder="Search by job or template" value={t.search} onChange={t.setSearch} /></div>
            <Button touch icon="chevronLeft" onClick={onBack}>{backLabel}</Button>
          </>
        }
      />
      <p className="mb-3 font-body text-sm text-muted">Showing messages sent by <span className="font-semibold text-foreground">{automation.name}</span> (ID {automation.id}).</p>
      <FilterChips touch chips={t.search ? [{ key: "search", label: `Search: ${t.search}` }] : []} onRemove={() => t.setSearch("")} onClear={() => t.setSearch("")} />
      <DataTable
        touch label="Communications" rowLabel={(r) => `job ${r.jobId}`} columns={columns} card={(r) => <LogCard row={r} />}
        onSortTo={t.setSort} rows={t.rows} loading={t.loading} error={t.error} onRetry={t.refresh} minWidth={900}
        sort={t.sort} onSort={t.toggleSort}
        empty={t.search
          ? <EmptyState icon="search" title="No communications match" body="Nothing fits your search. Clear it to see everything this automation sent."
              action={{ label: "Clear search", icon: "refresh", onClick: () => t.setSearch("") }} />
          : <EmptyState icon="inbox" title="Nothing sent yet" body="This automation has not sent any message. Messages will show here after it runs."
              action={{ label: backLabel, icon: "chevronLeft", onClick: onBack }} />}
      />
      <Pagination touch page={t.page} pages={t.pages} total={t.total} pageSize={t.pageSize} onPage={t.setPage} onPageSize={t.setPageSize} />
    </>
  );
}
