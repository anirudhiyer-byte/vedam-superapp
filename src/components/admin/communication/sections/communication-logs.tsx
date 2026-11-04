"use client";

import { useEffect, useRef, useState } from "react";
import {
  PageHeader, SearchBox, Button, Menu, FilterChips, ConfirmDialog, useToast,
} from "../ui/primitives";
import { DataTable, Pagination, BulkBar, useTableQuery } from "../ui/data-table";
import { FilterPanel, toChips, type FilterField } from "../ui/filter-panel";
import { EmptyState, InlineError } from "../ui/states";
import { useOptions } from "../ui/use-options";
import { commColumns } from "./commlogs/columns";
import { CommCard } from "./commlogs/comm-card";
import { RowMenu } from "./commlogs/row-menu";
import { PreviewDrawer } from "./commlogs/preview-drawer";
import { StatusDetail } from "./commlogs/status-detail";
import { CommDetailReport } from "./commlogs/detail-page";
import { commLogsApi, downloadCsv, CHANNEL_LABEL } from "../lib/mock-api";
import type { CommLogRow } from "../lib/types";

/**
 * MANAGE COMMUNICATION LOGS (v2)
 * Every job sent from the module. Job ID opens the Detailed Report (breadcrumb + Back), Preview opens a drawer,
 * the ⓘ next to a status opens Status Detail, the List Name link shows the list name, and the row gear has the
 * report actions (Amplify jobs can also be closed). Search, filters and page are kept when you come back.
 *
 * Data comes from `commLogsApi` (lib/mock-api.ts) — swap that for the real endpoint.
 */
type View = { kind: "list" } | { kind: "detail"; row: CommLogRow };

export function CommunicationLogs() {
  const t = useTableQuery<CommLogRow>({ fetcher: commLogsApi.list, pageSize: 10 });
  const { toast, toastNode } = useToast({ safe: true });
  const opts = useOptions(commLogsApi.options);

  const [view, setView] = useState<View>({ kind: "list" });
  const [filterOpen, setFilterOpen] = useState(false);
  const [preview, setPreview] = useState<CommLogRow | null>(null);
  const [statusRow, setStatusRow] = useState<CommLogRow | null>(null);
  const [askDownload, setAskDownload] = useState<"all" | "page" | "selected" | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [closing, setClosing] = useState<CommLogRow | null>(null);
  const [closePending, setClosePending] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const returnTo = useRef<string | null>(null);

  // back from the Detailed Report: put keyboard focus on the Job ID link we came from
  useEffect(() => {
    if (view.kind !== "list" || !returnTo.current) return;
    const id = returnTo.current; returnTo.current = null;
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-job="${id}"] button, [data-row-actions="${id}"]`)?.focus());
  }, [view]);

  const o = opts.options;
  const fields: FilterField[] = [
    { kind: "select", key: "form", placeholder: "All Forms", label: "Form", options: o.form ?? [] },
    { kind: "select", key: "channel", placeholder: "Medium of Communication", options: o.channel ?? [] },
    { kind: "select", key: "voiceType", placeholder: "Select Mio AI Voice Type", options: o.voiceType ?? [] },
    { kind: "select", key: "template", placeholder: "Select Template", options: o.template ?? [] },
    { kind: "select", key: "commFor", placeholder: "Communication For", options: o.commFor ?? [] },
    { kind: "select", key: "nature", placeholder: "Nature of Communication", options: o.nature ?? [] },
    { kind: "select", key: "sentBy", placeholder: "Sent By", options: o.sentBy ?? [] },
    { kind: "select", key: "status", placeholder: "Communication Status", options: o.status ?? [] },
    { kind: "select", key: "engagement", placeholder: "Select Channel", options: o.engagement ?? [] },
    { kind: "daterange", key: "startDate", placeholder: "Communication Date" },
    { kind: "select", key: "leadsType", placeholder: "Marketing Leads Type", options: o.leadsType ?? [] },
    { kind: "select", key: "listName", placeholder: "List or Segment List", options: o.listName ?? [] },
    { kind: "select", key: "campaignType", placeholder: "Select Campaign Type", options: o.campaignType ?? [] },
    { kind: "text", key: "campaignName", placeholder: "Enter Campaign Name", label: "Campaign Name" },
  ];

  const openDetail = (row: CommLogRow) => { returnTo.current = row.id; setView({ kind: "detail", row }); };
  const exportRows = (rows: CommLogRow[]) =>
    downloadCsv(
      `communication-logs-${Date.now()}.csv`,
      ["Channel", "Job ID", "Preview", "Template", "Status", "Start Date", "List", "Segment", "Targeted", "Delivered", "Automation ID", "Campaign Name", "Campaign Type", "Form", "Sent By", "Retry"],
      rows.map((r) => [CHANNEL_LABEL[r.channel], r.jobId, r.preview, r.template, r.status, r.startDate, r.listName, r.segmentName, r.targeted, r.delivered, r.automationId, r.campaignName ?? "", r.campaignType ?? "", r.form ?? "", r.sentBy ?? "", r.retry ?? ""]),
    );

  const runDownload = async (scope: "all" | "page" | "selected") => {
    setDownloading(true);
    try {
      const rows = scope === "page" ? t.rows
        : scope === "selected" ? t.rows.filter((r) => t.selected.includes(r.id))
        : (await commLogsApi.list({ search: t.search, filters: t.filters, sortKey: t.sort?.key, sortDir: t.sort?.dir })).rows;
      exportRows(rows);
      toast(`Downloaded ${rows.length} record(s)`);
    } catch (e) { toast(e instanceof Error && e.message ? e.message : "Could not download. Try again."); }
    finally { setDownloading(false); setAskDownload(null); }
  };

  const doClose = async () => {
    if (!closing) return;
    setClosePending(true); setCloseError(null);
    try { await commLogsApi.close(closing.id); toast(`${closing.jobId} closed`); setClosing(null); t.reload(); }
    catch (e) { setCloseError(e instanceof Error && e.message ? e.message : "Could not close this job. Try again."); }
    finally { setClosePending(false); }
  };

  const columns = commColumns({
    onDetail: openDetail, onPreview: setPreview, onInfo: setStatusRow,
    onAutomation: (id) => toast(`Automation ${id} is in Manage Automation`),
  });
  const filtered = !!t.search || t.activeFilters.length > 0;

  if (view.kind === "detail") return <CommDetailReport job={view.row} onBack={() => setView({ kind: "list" })} />;

  return (
    <>
      <PageHeader
        title="Manage Communication Logs"
        count={t.loading ? null : t.total}
        actions={
          <>
            <div className="w-full sm:w-auto"><SearchBox touch placeholder="Search by Job Id, Subject" value={t.search} onChange={t.setSearch} /></div>
            <Button touch icon="filter" active={t.activeFilters.length > 0} onClick={() => setFilterOpen(true)}>Filter</Button>
            <Menu
              align="right"
              touch
              items={[
                { label: "Download this page", icon: "download", onClick: () => setAskDownload("page") },
                { label: "Download all matching rows", icon: "download", onClick: () => setAskDownload("all") },
                { label: "Download selected", icon: "download", disabled: !t.selected.length, onClick: () => setAskDownload("selected") },
                { label: "Resend failed jobs", icon: "send", disabled: !t.rows.some((r) => r.status === "Failed"), onClick: () => toast("Resend queued for failed jobs") },
                { label: "Refresh", icon: "refresh", onClick: () => { t.refresh(); toast("Refreshed"); } },
              ]}
              trigger={(open, toggle) => <Button touch popup expanded={open} iconRight="chevronDown" active={open} onClick={toggle}>Action</Button>}
            />
          </>
        }
      />

      {opts.state.status === "error" && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border p-3">
          <InlineError>{opts.state.message}</InlineError>
          <Button size="sm" touch icon="refresh" onClick={opts.reload}>Try again</Button>
        </div>
      )}

      <FilterChips touch chips={toChips(t.filters, fields)} onRemove={t.removeFilter} onClear={t.clearFilters} />

      <BulkBar touch count={t.selected.length} onClear={() => t.setSelected([])}>
        <Button size="sm" touch icon="download" onClick={() => setAskDownload("selected")}>Download</Button>
        <Button size="sm" touch icon="send" onClick={() => toast(`Resend queued for ${t.selected.length} job(s)`)}>Resend</Button>
      </BulkBar>

      <DataTable
        touch
        label="Communication logs"
        rowLabel={(r) => `job ${r.jobId}`}
        columns={columns}
        card={(r) => <CommCard row={r} onDetail={openDetail} onPreview={setPreview} onInfo={setStatusRow} />}
        onSortTo={t.setSort}
        rows={t.rows}
        loading={t.loading}
        error={t.error}
        onRetry={t.refresh}
        minWidth={2150}
        selectable
        selected={t.selected}
        onSelect={t.setSelected}
        sort={t.sort}
        onSort={t.toggleSort}
        empty={filtered
          ? <EmptyState icon="search" title="No communication logs found" body="No job matches this search and these filters. Clear them to see every job."
              action={{ label: "Clear search and filters", icon: "refresh", onClick: () => { t.setSearch(""); t.clearFilters(); } }} />
          : <EmptyState icon="inbox" title="No communications yet" body="Jobs you send from the module will show up here."
              action={{ label: "Refresh", icon: "refresh", onClick: t.refresh }} />}
        rowActions={(r) => (
          <RowMenu row={r} act={{
            detail: openDetail,
            download: (x) => { exportRows([x]); toast(`Downloaded ${x.jobId}`); },
            close: (x) => { setCloseError(null); setClosing(x); },
            notBuilt: (what) => toast(`${what} is not built in this preview`),
          }} />
        )}
      />

      <Pagination touch page={t.page} pages={t.pages} total={t.total} pageSize={t.pageSize} onPage={t.setPage} onPageSize={t.setPageSize} />

      <FilterPanel touch open={filterOpen} fields={fields} value={t.filters} onClose={() => setFilterOpen(false)} onApply={t.setFilters} />
      <PreviewDrawer row={preview} onClose={() => setPreview(null)} />
      <StatusDetail row={statusRow} onClose={() => setStatusRow(null)} />

      <ConfirmDialog
        accessible
        open={!!askDownload}
        title="Download communication logs?"
        body={
          askDownload === "page" ? `A CSV of the ${t.rows.length} row(s) on this page will be downloaded.`
          : askDownload === "selected" ? `A CSV of the ${t.selected.length} selected row(s) will be downloaded.`
          : `A CSV of all ${t.total} row(s) matching your current search and filters will be downloaded.`
        }
        confirmLabel="Yes, download"
        pending={downloading}
        onCancel={() => { if (!downloading) setAskDownload(null); }}
        onConfirm={() => runDownload(askDownload!)}
      />

      <ConfirmDialog
        accessible
        open={!!closing}
        title="Close this Amplify job?"
        body={closing ? `${closing.jobId} will be marked as Closed. You can’t undo this in the preview.` : ""}
        confirmLabel="Yes, close it"
        pending={closePending}
        error={closeError}
        onCancel={() => { if (!closePending) setClosing(null); }}
        onConfirm={doClose}
      />

      {toastNode}
    </>
  );
}
