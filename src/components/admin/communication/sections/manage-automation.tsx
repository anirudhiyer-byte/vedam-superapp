"use client";

import { useEffect, useRef, useState } from "react";
import {
  PageHeader, RefreshStamp, SearchBox, IconButton, Button, Menu, Icon, FilterChips, ConfirmDialog, useToast, FOCUS_RING,
} from "../ui/primitives";
import { DataTable, Pagination, BulkBar, useTableQuery } from "../ui/data-table";
import { FilterPanel, toChips, type FilterField } from "../ui/filter-panel";
import { EmptyState, InlineError } from "../ui/states";
import { CreateAutomationDrawer } from "./automation/create-drawer";
import { EditAutomation } from "./automation/edit-page";
import { AutomationPerformance } from "./automation/performance-page";
import { RowMenu, type AutomationActions } from "./automation/row-menu";
import { AutomationCard } from "./automation/automation-card";
import { automationColumns } from "./automation/columns";
import { useAutomationOptions } from "./automation/use-options";
import { automationsApi, downloadCsv } from "../lib/mock-api";
import type { AutomationRow } from "../lib/types";

type Counts = { Active: number; Draft: number; Pause: number; Completed: number; Stopped: number; total: number; used: number; quota: number };
type View =
  | { kind: "list" }
  | { kind: "edit"; id: string; name: string }
  | { kind: "perf"; id: string; name: string; from: "list" | "edit" };
type Confirm = { kind: "delete" | "deactivate"; ids: string[]; label: string };

const TILES = [
  { key: "Active", tone: "text-[#4ade80]", ring: "border-[#4ade80]/50" },
  { key: "Draft", tone: "text-muted", ring: "border-border" },
  { key: "Pause", tone: "text-[#fbbf24]", ring: "border-[#fbbf24]/50" },
  { key: "Completed", tone: "text-accent-soft", ring: "border-accent/60" },
  { key: "Stopped", tone: "text-[#f87171]", ring: "border-[#f87171]/50" },
] as const;

const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/**
 * MANAGE AUTOMATION (v2)
 * Status tiles filter the table. The row menu depends on the status. Create Automation is a wizard in a drawer
 * (Category, Trigger, Conditions, Review) and opens the new Draft's workflow page. Edit Automation and View
 * Performance drill into pages in the same module (breadcrumb + Back). Search, filters and page are kept on return.
 *
 * Data comes from `automationsApi` (lib/mock-api.ts) — swap that for the real endpoint.
 */
export function ManageAutomation() {
  const t = useTableQuery<AutomationRow>({ fetcher: automationsApi.list, pageSize: 10 });
  const { toast, toastNode } = useToast({ safe: true });
  const opts = useAutomationOptions();

  const [view, setView] = useState<View>({ kind: "list" });
  const [filterOpen, setFilterOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [countsError, setCountsError] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [working, setWorking] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  // status tiles follow the search and the filters (except Status itself); `t.rows` is a new array after every fetch, so they also refresh after each change
  useEffect(() => {
    let live = true;
    automationsApi.counts({ search: t.search, filters: t.filters })
      .then((c) => { if (live) { setCounts(c); setCountsError(false); } })
      .catch(() => { if (live) setCountsError(true); });
    return () => { live = false; };
  }, [t.search, t.filters, t.rows]);

  // after a drill-down, or after Copy, put keyboard focus on that row's gear button
  const returnTo = useRef<string | null>(null);
  useEffect(() => {
    if (view.kind !== "list" || t.loading || !returnTo.current) return;
    const el = document.querySelector<HTMLElement>(`[data-row-actions="${returnTo.current}"]`);
    if (el) { el.focus(); returnTo.current = null; }
  }, [view, t.rows, t.loading]);

  const fields: FilterField[] = [
    { kind: "select", key: "status", label: "Status", placeholder: "Select Status", options: opts.options.status ?? [] },
    { kind: "select", key: "module", label: "Module", placeholder: "Select Module", options: opts.options.module ?? [] },
    { kind: "select", key: "list", label: "List", placeholder: "Select List", options: opts.options.list ?? [] },
    { kind: "select", key: "trigger", label: "Trigger", placeholder: "Select Trigger", options: opts.options.trigger ?? [] },
    { kind: "select", key: "createdBy", label: "Created by", placeholder: "Select Creator", options: opts.options.createdBy ?? [] },
    { kind: "select", key: "tags", label: "Tags", placeholder: "Select Tag", options: opts.options.tags ?? [] },
    { kind: "daterange", key: "createdOn", label: "Created on", placeholder: "Date range" },
    { kind: "daterange", key: "startDate", label: "Start date", placeholder: "Date range" },
    { kind: "daterange", key: "endDate", label: "End date", placeholder: "Date range" },
  ];

  const status = t.filters.status ?? "";
  const pickStatus = (s: string) => t.setFilters({ ...t.filters, status: status === s ? "" : s });
  const selectedRows = t.rows.filter((r) => t.selected.includes(r.id));
  const full = !!counts && counts.used >= counts.quota;

  const exportRows = (rows: AutomationRow[]) =>
    downloadCsv(`automations-${Date.now()}.csv`,
      ["ID", "Name", "Module", "List", "Trigger", "Status", "Created On", "Created By", "Start Date", "End Date", "Tags"],
      rows.map((r) => [r.id, r.name, r.module, r.list, r.trigger, r.status, r.createdOn, r.createdBy, r.startDate, r.endDate, (r.tags ?? []).join("; ")]));

  const runStatus = async (ids: string[], to: "Active" | "Pause" | "Stopped", done: string) => {
    try {
      const r = await automationsApi.setStatus(ids, to);
      toast(r.changed === 0 ? "Nothing to change for the selected automations" : `${done}${r.skipped ? ` (${r.skipped} skipped)` : ""}`);
      t.reload();
    } catch (e) { toast(errText(e, "We could not change the status.")); }
  };

  const act: AutomationActions = {
    edit: (r) => { returnTo.current = r.id; setView({ kind: "edit", id: r.id, name: r.name }); },
    performance: (r) => { returnTo.current = r.id; setView({ kind: "perf", id: r.id, name: r.name, from: "list" }); },
    copy: async (r) => {
      try {
        const row = await automationsApi.duplicate(r.id);
        toast(`Copied as “${row.name}” (Draft)`);
        returnTo.current = row.id; t.setPage(1); t.reload();
      } catch (e) { toast(errText(e, "We could not copy the automation.")); }
    },
    pause: (r) => runStatus([r.id], "Pause", `${r.name} paused`),
    resume: (r) => runStatus([r.id], "Active", `${r.name} resumed`),
    deactivate: (r) => { setConfirmError(null); setConfirm({ kind: "deactivate", ids: [r.id], label: r.name }); },
    remove: (r) => { setConfirmError(null); setConfirm({ kind: "delete", ids: [r.id], label: r.name }); },
  };

  const confirmRun = async () => {
    if (!confirm || working) return;
    setWorking(true); setConfirmError(null);
    try {
      if (confirm.kind === "delete") {
        await automationsApi.remove(confirm.ids);
        toast(`Deleted ${confirm.ids.length === 1 ? confirm.label : `${confirm.ids.length} automations`}`);
        t.setSelected([]);
        // the row (and its button) is gone, so land on the search box
        requestAnimationFrame(() => document.querySelector<HTMLInputElement>('input[aria-label="Search automations"]')?.focus());
      } else {
        await automationsApi.setStatus(confirm.ids, "Stopped");
        toast(`${confirm.label} de-activated`);
        returnTo.current = confirm.ids[0];
      }
      setConfirm(null); t.reload();
    } catch (e) {
      setConfirmError(errText(e, "We could not do that. Please try again."));
    } finally {
      setWorking(false);
    }
  };

  const toList = () => setView({ kind: "list" });
  const backAndRefresh = () => { toList(); t.reload(); };

  /* ── drill-down pages (breadcrumb + Back) ── */
  if (view.kind === "edit") {
    return (
      <>
        <EditAutomation id={view.id} name={view.name} onBack={backAndRefresh} onToast={toast}
          onPerformance={(r) => setView({ kind: "perf", id: r.id, name: r.name, from: "edit" })} />
        {toastNode}
      </>
    );
  }
  if (view.kind === "perf") {
    return (
      <>
        <AutomationPerformance automation={{ id: view.id, name: view.name }} from={view.from}
          onBack={view.from === "edit" ? () => setView({ kind: "edit", id: view.id, name: view.name }) : toList}
          onList={backAndRefresh} onOpenEditor={() => setView({ kind: "edit", id: view.id, name: view.name })} />
        {toastNode}
      </>
    );
  }

  const columns = automationColumns({ onOpen: act.edit });
  const filtered = !!t.search || t.activeFilters.length > 0;
  const hasActive = selectedRows.some((r) => r.status === "Active");

  return (
    <>
      <PageHeader
        title="Manage Automations"
        count={t.loading ? null : t.total}
        countLabel={t.total === 1 ? "Automation" : "Automations"}
        meta={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {counts && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-warm px-2.5 py-1 font-mono text-[11px] text-foreground">
                <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${full ? "bg-[#f87171]" : "bg-accent"}`} />
                Total automation — {counts.used}/{counts.quota}{full ? " · limit reached" : ""}
              </span>
            )}
            <RefreshStamp touch at={t.refreshedAt} onRefresh={t.refresh} busy={t.loading} />
          </div>
        }
        actions={
          <>
            <div className="w-full sm:w-auto"><SearchBox touch placeholder="Search automations" value={t.search} onChange={t.setSearch} /></div>
            <IconButton touch icon="filter" label="Filter" active={t.activeFilters.length > 0} onClick={() => setFilterOpen(true)} />
            <Menu align="right" touch
              items={[
                { label: "Download all as CSV", icon: "download", onClick: () => { exportRows(t.rows); toast("Download started"); } },
                { label: "Download selected", icon: "download", disabled: !t.selected.length, onClick: () => { exportRows(selectedRows); toast("Download started"); } },
                { label: "Refresh", icon: "refresh", onClick: () => { t.refresh(); toast("Refreshed"); } },
              ]}
              trigger={(open, toggle) => <Button touch popup expanded={open} iconRight="chevronDown" active={open} onClick={toggle}>Action</Button>} />
            <Button touch variant="solid" icon="plus" disabled={full} title={full ? "You have used all 40 automations. Delete one to create another." : undefined}
              onClick={() => setCreateOpen(true)}>Create automation</Button>
          </>
        }
      />

      {opts.state.status === "error" && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border p-3">
          <InlineError>{opts.state.message}</InlineError>
          <Button size="sm" touch icon="refresh" onClick={opts.reload}>Try again</Button>
        </div>
      )}

      {/* status tiles — each one filters the table */}
      <div role="group" aria-label="Filter by status" className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {TILES.map((tile) => {
          const on = status === tile.key;
          const n = counts ? counts[tile.key] : null;
          return (
            <button key={tile.key} type="button" aria-pressed={on} onClick={() => pickStatus(tile.key)}
              aria-label={`${tile.key}: ${n ?? "unknown"}`}
              className={`min-h-[44px] rounded-2xl border bg-surface p-4 text-left transition-colors hover:bg-surface-warm/50 last:col-span-2 sm:last:col-span-1 ${FOCUS_RING} ${on ? `${tile.ring} ring-1 ring-inset ring-accent` : "border-border"}`}>
              <span className="flex items-center justify-between">
                <span aria-hidden className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted">{tile.key}</span>
                {on && <Icon name="check" className="h-3.5 w-3.5 text-accent" />}
              </span>
              <span aria-hidden className={`mt-1 block font-display text-2xl font-extrabold ${tile.tone}`}>
                {counts ? counts[tile.key] : countsError ? "—" : <span className="inline-block h-6 w-8 animate-pulse rounded bg-surface-warm" />}
              </span>
            </button>
          );
        })}
      </div>

      <FilterChips touch chips={toChips(t.filters, fields)} onRemove={t.removeFilter} onClear={t.clearFilters} />

      <BulkBar touch count={t.selected.length} onClear={() => t.setSelected([])}>
        <Button size="sm" touch icon="check" onClick={() => runStatus(t.selected, "Active", `Activated`)}>Activate</Button>
        <Button size="sm" touch icon="clock" onClick={() => runStatus(t.selected, "Pause", `Paused`)}>Pause</Button>
        <Button size="sm" touch variant="danger" icon="trash" disabled={hasActive}
          title={hasActive ? "Active automations can’t be deleted. De-activate them first." : undefined}
          onClick={() => { setConfirmError(null); setConfirm({ kind: "delete", ids: t.selected, label: `${t.selected.length} automation(s)` }); }}>Delete</Button>
      </BulkBar>

      <DataTable
        touch
        label="Automations"
        rowLabel={(r) => `automation ${r.name}`}
        columns={columns}
        card={(r) => <AutomationCard row={r} onOpen={act.edit} />}
        onSortTo={t.setSort}
        rows={t.rows}
        loading={t.loading}
        error={t.error}
        onRetry={t.refresh}
        minWidth={1500}
        selectable
        selected={t.selected}
        onSelect={t.setSelected}
        sort={t.sort}
        onSort={t.toggleSort}
        empty={filtered
          ? <EmptyState icon="search" title="No automations match" body="Nothing fits your search and filters. Clear them to see every automation."
              action={{ label: "Clear search and filters", icon: "refresh", onClick: () => { t.setSearch(""); t.clearFilters(); } }} />
          : <EmptyState icon="flow" title="No automations yet" body="Create your first automation to send messages without doing it by hand."
              action={{ label: "Create automation", icon: "plus", onClick: () => setCreateOpen(true) }} />}
        rowActions={(r) => <RowMenu row={r} act={act} />}
      />

      <Pagination touch page={t.page} pages={t.pages} total={t.total} pageSize={t.pageSize} onPage={t.setPage} onPageSize={t.setPageSize} />

      <FilterPanel touch open={filterOpen} fields={fields} value={t.filters} onClose={() => setFilterOpen(false)} onApply={t.setFilters} />

      <CreateAutomationDrawer open={createOpen} used={counts?.used ?? null} quota={counts?.quota ?? null} onClose={() => setCreateOpen(false)}
        onCreated={(row) => {
          setCreateOpen(false); toast(`Automation “${row.name}” created as a Draft`);
          returnTo.current = row.id; setView({ kind: "edit", id: row.id, name: row.name });
        }} />

      <ConfirmDialog
        accessible
        open={!!confirm}
        pending={working}
        error={confirmError}
        title={confirm?.kind === "deactivate" ? "De-activate automation?" : "Delete automation?"}
        confirmLabel={confirm?.kind === "deactivate" ? "De-activate" : "Delete"}
        body={confirm?.kind === "deactivate"
          ? `${confirm.label} will stop for every record. You can’t turn it on again, but you can copy it. Messages already sent are not affected.`
          : `${confirm?.label ?? ""} will be removed. Messages already sent are not affected.`}
        onCancel={() => { if (!working) setConfirm(null); }}
        onConfirm={confirmRun}
      />

      {toastNode}
    </>
  );
}
