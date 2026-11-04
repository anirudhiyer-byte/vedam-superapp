"use client";

import { useId, useState } from "react";
import { PageHeader, SearchBox, Button, Icon, Menu, StatusPill, Dash, FilterChips, ConfirmDialog, useToast, FOCUS_RING } from "../../ui/primitives";
import { Breadcrumb } from "../../ui/breadcrumb";
import { DataTable, Pagination, useTableQuery, type Column } from "../../ui/data-table";
import { FilterPanel, toChips, type FilterField } from "../../ui/filter-panel";
import { EmptyState, InlineError, Skeleton } from "../../ui/states";
import { useLoad } from "../../ui/use-load";
import { commLogsApi, downloadCsv, CHANNEL_LABEL } from "../../lib/mock-api";
import type { CommDetailRow, CommLogRow, CommStats } from "../../lib/types";

const FIELDS: FilterField[] = [
  { kind: "select", key: "medium", placeholder: "Medium of Communication", options: [], locked: true },
  { kind: "daterange", key: "date", placeholder: "Date of communication" },
  { kind: "select", key: "status", placeholder: "Select Communication Status", options: ["Sent", "Delivered", "Read", "Failed", "Clicked", "Replied"].map((v) => ({ value: v, label: v })) },
  { kind: "select", key: "conversationType", placeholder: "Select Conversation Type", options: ["Service", "Marketing", "Utility"].map((v) => ({ value: v, label: v })) },
  { kind: "select", key: "waba", placeholder: "Select WABA Number", options: [{ value: "vsot", label: "VSOT (WABA number)" }] },
];

const CARDS: { key: keyof CommStats; label: string; tone: string }[] = [
  { key: "sent", label: "Sent", tone: "text-heading" }, { key: "delivered", label: "Delivered", tone: "text-[#4ade80]" }, { key: "read", label: "Read", tone: "text-[#4ade80]" },
  { key: "failed", label: "Failed", tone: "text-[#f87171]" }, { key: "clicked", label: "Clicked", tone: "text-accent-soft" }, { key: "replied", label: "Replied", tone: "text-accent-soft" },
  { key: "unsubscribed", label: "Unsubscribed", tone: "text-[#fbbf24]" }, { key: "flowResponse", label: "Flow Response", tone: "text-muted" },
];

function Stats({ id }: { id: string }) {
  const { state, reload } = useLoad(() => commLogsApi.detailStats(id), "Could not load the stats.");
  if (state.status === "loading") return <div aria-busy="true" className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">{CARDS.map((c) => <Skeleton key={c.key} className="h-20" />)}</div>;
  if (state.status === "error") return <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-border p-3"><InlineError>{state.message}</InlineError><Button size="sm" touch icon="refresh" onClick={reload}>Try again</Button></div>;
  const s = state.data;
  return (
    <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
      {CARDS.map((c) => (
        <div key={c.key} className="rounded-xl border border-border bg-surface p-3">
          <dt className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted">{c.label}</dt>
          <dd className={`mt-1 font-display text-xl font-extrabold ${c.tone}`}>{c.key === "sent" ? s.sent : s.sent ? `${Math.round((s[c.key] / s.sent) * 100)}%` : "0%"}</dd>
          {c.key !== "sent" && <dd className="font-mono text-[11px] text-muted">{s[c.key]}</dd>}
        </div>
      ))}
    </dl>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- kept for the lead-link column (not built yet)
const columns = (onLead: (r: CommDetailRow) => void): Column<CommDetailRow>[] => [
  { id: "automationId", header: "Automation ID", cell: (r) => r.automationId },
  { id: "jobId", header: "Job Id", sortable: true, cell: (r) => <span className="font-mono text-xs">{r.jobId}</span> },
  { id: "type", header: "Type", cell: (r) => r.type },
  { id: "name", header: "Name", sortable: true, sticky: true, width: 170, cell: (r) => r.name },
  { id: "moduleType", header: "Module Type", cell: (r) => r.moduleType },
  { id: "listName", header: "Opportunity List Name", cell: (r) => r.listName },
  { id: "template", header: "Template Name", cell: (r) => (r.template === "NA" ? <Dash /> : r.template) },
  { id: "to", header: "To", cell: (r) => <span className="font-mono text-xs">{r.to}</span> },
  { id: "date", header: "Communication Date", sortable: true, cell: (r) => r.date },
  { id: "conversationType", header: "Conversation Type", cell: (r) => r.conversationType },
  { id: "region", header: "Region", cell: (r) => r.region },
  { id: "status", header: "Status", sortable: true, cell: (r) => <StatusPill status={r.status} /> },
];

function DetailCard({ row }: { row: CommDetailRow }) {
  const fact = (l: string, v: string) => <div className="min-w-0"><dt className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted">{l}</dt><dd className="mt-0.5 break-words font-body text-xs text-foreground">{v || "—"}</dd></div>;
  return (
    <>
      <h2 className="font-display text-base font-bold text-heading">{row.name}</h2>
      <p className="font-mono text-[11px] text-muted">{row.to} · Job {row.jobId}</p>
      <div className="mt-2"><StatusPill status={row.status} /></div>
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
        {fact("Sent", row.date)}{fact("Conversation", row.conversationType)}{fact("Template", row.template === "NA" ? "" : row.template)}{fact("Module", row.moduleType)}
      </dl>
    </>
  );
}

/**
 * COMMUNICATION LOGS DETAILED REPORT — opens from a Job ID or "View Detailed Report" (breadcrumb + Back).
 * One row per recipient. WhatsApp jobs also have the stats cards.
 * Only a WhatsApp job was opened in Meritto, so the other channels reuse the same table without the cards.
 */
export function CommDetailReport({ job, onBack }: { job: CommLogRow; onBack: () => void }) {
  const t = useTableQuery<CommDetailRow>({ fetcher: (q) => commLogsApi.detail(job.id, q), pageSize: 10 });
  const { toast, toastNode } = useToast({ safe: true });
  const [filterOpen, setFilterOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [askDownload, setAskDownload] = useState<"page" | "all" | null>(null);
  const [downloading, setDownloading] = useState(false);
  const statsId = useId();
  const isWa = job.channel === "whatsapp";

  const fields = FIELDS.filter((f) => isWa || (f.key !== "conversationType" && f.key !== "waba")).map((f) => (f.key === "medium" ? { ...f, options: [{ value: "m", label: CHANNEL_LABEL[job.channel] }] } : f)) as FilterField[];
  const filtered = !!t.search || t.activeFilters.length > 0;

  const runDownload = async (scope: "page" | "all") => {
    setDownloading(true);
    try {
      const rows = scope === "page" ? t.rows : (await commLogsApi.detail(job.id, { search: t.search, filters: t.filters, sortKey: t.sort?.key, sortDir: t.sort?.dir })).rows;
      downloadCsv(`communication-detail-${job.jobId.replace("#", "")}-${Date.now()}.csv`,
        ["Automation ID", "Job Id", "Type", "Name", "Module Type", "List", "Template", "To", "Communication Date", "Conversation Type", "Region", "Status"],
        rows.map((r) => [r.automationId, r.jobId, r.type, r.name, r.moduleType, r.listName, r.template, r.to, r.date, r.conversationType, r.region, r.status]));
      toast(`Downloaded ${rows.length} record(s)`);
    } catch (e) { toast(e instanceof Error && e.message ? e.message : "Could not download. Try again."); }
    finally { setDownloading(false); setAskDownload(null); }
  };

  return (
    <>
      <Breadcrumb items={[{ label: "Manage Communication Logs", onClick: onBack }, { label: job.jobId }, { label: "Detailed report" }]} />
      <PageHeader
        title="Communication Logs Detailed Report"
        count={t.loading ? null : t.total}
        countLabel={t.total === 1 ? "Record" : "Records"}
        meta={<p className="font-body text-xs text-muted">{job.jobId} · {CHANNEL_LABEL[job.channel]} · {job.template === "-" ? "No template" : job.template}</p>}
        actions={
          <>
            <div className="w-full sm:w-auto"><SearchBox touch placeholder="Search by name or recipient" value={t.search} onChange={t.setSearch} /></div>
            <Button touch icon="filter" active={t.activeFilters.length > 0} onClick={() => setFilterOpen(true)}>Filter</Button>
            <Menu align="right" touch
              items={[{ label: "Download this page", icon: "download", onClick: () => setAskDownload("page") }, { label: "Download all matching rows", icon: "download", onClick: () => setAskDownload("all") }]}
              trigger={(open, toggle) => <Button touch popup expanded={open} variant="solid" icon="download" iconRight="chevronDown" active={open} onClick={toggle}>Download</Button>} />
            <Button touch icon="chevronLeft" onClick={onBack}>Back to Manage Communication Logs</Button>
          </>
        }
      />

      {isWa && (
        <div className="mb-3">
          <button type="button" aria-expanded={statsOpen} aria-controls={statsId} onClick={() => setStatsOpen((v) => !v)}
            className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-[#fbbf24]/60 px-3 font-body text-sm font-semibold text-[#fbbf24] hover:bg-surface-warm sm:min-h-0 sm:py-2 ${FOCUS_RING}`}>
            <Icon name="chart" className="h-3.5 w-3.5" /> WhatsApp stats <Icon name={statsOpen ? "chevronDown" : "chevronRight"} className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {isWa && statsOpen && <div id={statsId}><Stats id={job.id} /></div>}

      <FilterChips touch chips={toChips(t.filters, fields)} onRemove={t.removeFilter} onClear={t.clearFilters} />

      <DataTable
        touch label="Detailed report" rowLabel={(r) => `${r.name}, ${r.to}`} columns={columns(() => undefined)}
        card={(r) => <DetailCard row={r} />} onSortTo={t.setSort}
        rows={t.rows} loading={t.loading} error={t.error} onRetry={t.refresh} minWidth={1400} sort={t.sort} onSort={t.toggleSort}
        empty={filtered
          ? <EmptyState icon="search" title="No records match" body="Nothing fits this search and these filters. Clear them to see everyone." action={{ label: "Clear search and filters", icon: "refresh", onClick: () => { t.setSearch(""); t.clearFilters(); } }} />
          : <EmptyState icon="inbox" title="No recipients yet" body="Nobody has received this communication yet." action={{ label: "Back to Manage Communication Logs", icon: "chevronLeft", onClick: onBack }} />}
        rowActions={(r) => (
          <Menu align="right" touch items={[{ label: "View Lead Detail", icon: "userSwap", onClick: () => toast(`Lead page for ${r.name} is in the Leads module (not in this preview)`) }]}
            trigger={(open, toggle) => (
              <button type="button" onClick={toggle} aria-label={`Actions for ${r.name}`} aria-haspopup="menu" aria-expanded={open}
                className={`grid h-11 w-11 place-items-center rounded-lg sm:h-8 sm:w-8 ${FOCUS_RING} ${open ? "bg-surface-warm text-accent" : "text-muted hover:bg-surface-warm hover:text-foreground"}`}><Icon name="gear" className="h-4 w-4" /></button>
            )} />
        )}
      />

      <Pagination touch page={t.page} pages={t.pages} total={t.total} pageSize={t.pageSize} onPage={t.setPage} onPageSize={t.setPageSize} />
      <FilterPanel touch open={filterOpen} fields={fields} value={t.filters} onClose={() => setFilterOpen(false)} onApply={t.setFilters} />
      <ConfirmDialog accessible open={!!askDownload} title="Download detailed report?" confirmLabel="Yes, download" pending={downloading}
        body={askDownload === "page" ? `A CSV of the ${t.rows.length} row(s) on this page will be downloaded.` : `A CSV of all ${t.total} row(s) matching your search and filters will be downloaded.`}
        onCancel={() => { if (!downloading) setAskDownload(null); }} onConfirm={() => runDownload(askDownload!)} />
      {toastNode}
    </>
  );
}
