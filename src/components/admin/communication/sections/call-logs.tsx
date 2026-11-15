"use client";

import { useState } from "react";
import {
  PageHeader, SearchBox, Button, Icon, LinkText, Dash,
  FilterChips, ConfirmDialog, useToast, Menu,
} from "../ui/primitives";
import { DataTable, Pagination, useTableQuery, type Column } from "../ui/data-table";
import { FilterPanel, toChips, type FilterField } from "../ui/filter-panel";
import { EmptyState, InlineError } from "../ui/states";
import { useOptions } from "../ui/use-options";
import { CallCard, callStatusTone } from "./calls/call-card";
import { callsApi, downloadCsv } from "../lib/mock-api";
import type { CallRow } from "../lib/types";

/**
 * IN-APP CALL LOGS (v2)
 * Filter drawer: Institute / Users / Call Type (Incoming, Outgoing, Missed) / Calling Date (quick ranges + custom).
 * Search matches the applicant's name or mobile number. Download asks first, then writes a CSV of the current query.
 * The applicant name belongs to the Leads module, so here it only shows a toast (no lead profile in this preview).
 *
 * Data comes from `callsApi` (lib/mock-api.ts) — swap that for the real endpoint.
 */
export function CallLogs() {
  const t = useTableQuery<CallRow>({ fetcher: callsApi.list, pageSize: 10 });
  const { toast, toastNode } = useToast({ safe: true });
  const opts = useOptions(callsApi.options);

  const [filterOpen, setFilterOpen] = useState(false);
  const [askDownload, setAskDownload] = useState<"all" | "page" | null>(null);
  const [downloading, setDownloading] = useState(false);

  const o = opts.options;
  const fields: FilterField[] = [
    { kind: "select", key: "institute", placeholder: "Vedam School of Technology", options: o.institute ?? [], locked: true },
    { kind: "select", key: "user", placeholder: "Select Users", options: o.user ?? [] },
    { kind: "select", key: "callingType", placeholder: "Select Call Type", options: o.callingType ?? [] },
    { kind: "select", key: "callStatus", placeholder: "Select Call Status", options: o.callStatus ?? [] },
    { kind: "daterange", key: "callDate", placeholder: "In-App Calling Date" },
  ];

  const openLead = (r: CallRow) => toast(`Open lead → ${r.applicant}`);

  const columns: Column<CallRow>[] = [
    {
      id: "applicant", header: "Applicant Name", sortable: true, sticky: true, width: 175,
      cell: (r) => (r.applicant ? <LinkText touch onClick={() => openLead(r)}>{r.applicant}</LinkText> : <Dash />),
    },
    { id: "mobile", header: "Applicant Mobile No.", sortable: true, cell: (r) => <span className="font-mono text-xs">{r.mobile}</span> },
    {
      id: "callingType", header: "Calling Type", sortable: true,
      cell: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <Icon name={r.callingType === "Incoming" ? "chevronLeft" : "chevronRight"} className="h-3 w-3 text-muted" />
          {r.callingType}
        </span>
      ),
    },
    { id: "user", header: "User Name", sortable: true, cell: (r) => r.user },
    { id: "callStatus", header: "Call Status", sortable: true, cell: (r) => <span className={`font-semibold ${callStatusTone(r.callStatus)}`}>{r.callStatus}</span> },
    { id: "leadStatus", header: "Lead Status", sortable: true, cell: (r) => r.leadStatus || <Dash /> },
    { id: "startTime", header: "Start Time", sortable: true, cell: (r) => r.startTime },
    { id: "endTime", header: "End Time", sortable: true, cell: (r) => r.endTime },
    { id: "durationSec", header: "Duration", align: "right", sortable: true, cell: (r) => <span className="tabular-nums">{r.durationSec} s</span> },
  ];

  const runDownload = async (scope: "all" | "page") => {
    setDownloading(true);
    try {
      const rows = scope === "page"
        ? t.rows
        : (await callsApi.list({ search: t.search, filters: t.filters, sortKey: t.sort?.key, sortDir: t.sort?.dir })).rows;
      downloadCsv(
        `in-app-call-logs-${Date.now()}.csv`,
        ["Applicant Name", "Mobile No.", "Calling Type", "User Name", "Call Status", "Lead Status", "Start Time", "End Time", "Duration (s)"],
        rows.map((r) => [r.applicant, r.mobile, r.callingType, r.user, r.callStatus, r.leadStatus, r.startTime, r.endTime, r.durationSec]),
      );
      toast(`Downloaded ${rows.length} record(s)`);
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : "Could not download. Try again.");
    } finally {
      setDownloading(false);
      setAskDownload(null);
    }
  };

  const filtered = !!t.search || t.activeFilters.length > 0;

  return (
    <>
      <PageHeader
        title="In-App Call Logs"
        count={t.loading ? null : t.total}
        countLabel={t.total === 1 ? "Record" : "Records"}
        actions={
          <>
            <div className="w-full sm:w-auto"><SearchBox touch placeholder="Search by name or mobile no." value={t.search} onChange={t.setSearch} /></div>
            <Button touch icon="filter" active={t.activeFilters.length > 0} onClick={() => setFilterOpen(true)}>Filter</Button>
            <Menu
              align="right"
              touch
              items={[
                { label: "Download this page", icon: "download", onClick: () => setAskDownload("page") },
                { label: "Download all matching rows", icon: "download", onClick: () => setAskDownload("all") },
              ]}
              trigger={(open, toggle) => (
                <Button touch popup expanded={open} variant="solid" icon="download" iconRight="chevronDown" active={open} onClick={toggle}>Download</Button>
              )}
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

      <DataTable
        touch
        label="In-app call logs"
        rowLabel={(r) => `call with ${r.applicant || r.mobile} at ${r.startTime}`}
        columns={columns}
        card={(r) => <CallCard row={r} onOpenLead={openLead} />}
        onSortTo={t.setSort}
        rows={t.rows}
        loading={t.loading}
        error={t.error}
        onRetry={t.refresh}
        minWidth={1120}
        sort={t.sort}
        onSort={t.toggleSort}
        empty={filtered
          ? <EmptyState icon="search" title="No call logs found" body="No call matches this search and these filters. Clear them to see every call."
              action={{ label: "Clear search and filters", icon: "refresh", onClick: () => { t.setSearch(""); t.clearFilters(); } }} />
          : <EmptyState icon="phone" title="No calls yet" body="Calls made or received in the app will show up here."
              action={{ label: "Refresh", icon: "refresh", onClick: t.refresh }} />}
      />

      <Pagination touch page={t.page} pages={t.pages} total={t.total} pageSize={t.pageSize} onPage={t.setPage} onPageSize={t.setPageSize} />

      {t.page < t.pages && !t.loading && (
        <div className="mt-3 flex justify-center">
          <Button touch icon="refresh" onClick={() => t.setPage(t.page + 1)}>Load more logs</Button>
        </div>
      )}

      <FilterPanel touch open={filterOpen} fields={fields} value={t.filters} onClose={() => setFilterOpen(false)} onApply={t.setFilters} />

      <ConfirmDialog
        accessible
        open={!!askDownload}
        title="Download call logs?"
        body={askDownload === "page"
          ? `A CSV of the ${t.rows.length} row(s) on this page will be downloaded.`
          : `A CSV of all ${t.total} row(s) matching your current search and filters will be downloaded.`}
        confirmLabel="Yes, download"
        pending={downloading}
        onCancel={() => { if (!downloading) setAskDownload(null); }}
        onConfirm={() => runDownload(askDownload!)}
      />

      {toastNode}
    </>
  );
}
