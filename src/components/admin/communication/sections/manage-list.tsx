"use client";

import { useEffect, useRef, useState } from "react";
import {
  PageHeader, RefreshStamp, SearchBox, IconButton, Button, Menu, FilterChips, ConfirmDialog, useToast, FOCUS_RING,
} from "../ui/primitives";
import { DataTable, Pagination, BulkBar, useTableQuery } from "../ui/data-table";
import { FilterPanel, toChips, type FilterField } from "../ui/filter-panel";
import { EmptyState } from "../ui/states";
import { UploadRawData } from "./upload-raw-data";
import { EditList } from "./lists/edit-list";
import { TagDrawer } from "./lists/tag-drawer";
import { OwnerModal } from "./lists/owner-modal";
import { CommunicateDrawer } from "./lists/communicate-drawer";
import { RowMenu } from "./lists/row-menu";
import { listColumns } from "./lists/columns";
import { ListCard } from "./lists/list-card";
import { useListOptions } from "./lists/use-options";
import { listsApi, downloadCsv } from "../lib/mock-api";
import { isLivePage } from "../lib/live-config";
import { ListBuilder, type BuilderMode } from "./lists/list-builder";
import type { ListRow } from "../lib/types";

/** Where Manage List can send you inside the module. The shell turns these into section switches. */
export type ListNavTarget = "upload" | "commLogs";

type View = { kind: "list" } | { kind: "import"; list: ListRow } | { kind: "edit"; list: ListRow };

/**
 * MANAGE LIST (v2)
 * Row actions open in the same module: Import Contact and Edit List drill into a page with a
 * breadcrumb + Back; Communicate and Add Tag are drawers; Change List Owner is a modal.
 * Search, filters and the page you were on are kept when you come back.
 *
 * Data comes from `listsApi` (lib/mock-api.ts). LIVE mode (Slice 3a, lib/live-config.ts): lists are saved filters on
 * VSAT data — "New list", "Edit List" and "View Count" open the ListBuilder drawer (counts + masked sample only).
 * Sending, upload/import, owner change, tags and the old filter panel are not available on live lists yet.
 */
export function ManageList({ onNavigate }: { onNavigate?: (to: ListNavTarget) => void }) {
  const t = useTableQuery<ListRow>({ fetcher: listsApi.list, pageSize: 10 });
  const { toast, toastNode } = useToast({ safe: true });
  const opts = useListOptions();

  const [view, setView] = useState<View>({ kind: "list" });
  const [filterOpen, setFilterOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ ids: string[]; label: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [tagList, setTagList] = useState<ListRow | null>(null);
  const [ownerList, setOwnerList] = useState<ListRow | null>(null);
  const [commLists, setCommLists] = useState<ListRow[]>([]);
  const live = isLivePage("lists");
  const [builder, setBuilder] = useState<{ mode: BuilderMode; list: ListRow | null } | null>(null);

  // after a drill-down, put keyboard focus back on the row's gear button
  const returnTo = useRef<string | null>(null);
  const toList = () => setView({ kind: "list" });
  const backAndRefresh = () => { toList(); t.reload(); };
  useEffect(() => {
    if (view.kind !== "list" || !returnTo.current) return;
    const el = document.querySelector<HTMLElement>(`[data-row-actions="${returnTo.current}"]`);
    if (el) { el.focus(); returnTo.current = null; }
  }, [view, t.rows]);

  const fields: FilterField[] = [
    { kind: "select", key: "institute", label: "Institute", placeholder: "Vedam School of Technology", options: opts.options.institute ?? [], locked: true },
    { kind: "select", key: "form", label: "Form", placeholder: "Select Form", options: opts.options.form ?? [] },
    { kind: "select", key: "owner", label: "List owner", placeholder: "List Owner", options: opts.options.owner ?? [] },
    { kind: "select", key: "origin", label: "List origin", placeholder: "List Origin", options: opts.options.origin ?? [] },
    { kind: "daterange", key: "createdOn", label: "Created on", placeholder: "Date range" },
  ];

  const selectedRows = t.rows.filter((r) => t.selected.includes(r.id));
  const selectionHasSystem = selectedRows.some((r) => r.id === "-");
  const askDelete = (ids: string[], label: string) => { setDeleteError(null); setConfirm({ ids, label }); };

  const exportRows = (rows: ListRow[]) =>
    downloadCsv(
      `manage-lists-${Date.now()}.csv`,
      ["ID", "List Name", "List Origin", "Total Leads", "Unique Email ID", "Unique Mobile Number", "Created On", "Created By", "List Owner"],
      rows.map((r) => [r.id, r.name, r.origin, r.totalLeads, r.uniqueEmail, r.uniqueMobile, r.createdOn, r.createdBy, r.owner]),
    );

  const onCount = (r: ListRow) => (live && r.live ? setBuilder({ mode: "view", list: r }) : toast("Opening count breakdown…"));
  const columns = listColumns({ onTags: setTagList, onCount });

  const confirmDelete = async () => {
    if (!confirm || deleting) return;
    setDeleting(true); setDeleteError(null);
    try {
      await listsApi.remove(confirm.ids);
      toast(`Deleted ${confirm.ids.length} list(s)`);
      setConfirm(null); t.setSelected([]); t.reload();
      // the row (and its button) is gone, so land on the search box instead of the page top
      requestAnimationFrame(() => document.querySelector<HTMLInputElement>('input[aria-label="Search by"]')?.focus());
    } catch (e) {
      setDeleteError(e instanceof Error && e.message ? e.message : "We could not delete. Please try again.");
    } finally {
      setDeleting(false);
    }
  };

  /* ── drill-down pages (breadcrumb + Back) ── */
  if (view.kind === "import") {
    return (
      <>
        <UploadRawData entryList={{ id: view.list.id, name: view.list.name }} onBack={backAndRefresh} />
        {toastNode}
      </>
    );
  }
  if (view.kind === "edit") {
    return (
      <>
        <EditList list={view.list} onBack={toList} onSaved={(m) => { toast(m); backAndRefresh(); }} />
        {toastNode}
      </>
    );
  }

  const filtered = !!t.search || t.activeFilters.length > 0;
  const act = {
    importContact: (r: ListRow) => { returnTo.current = r.id; setView({ kind: "import", list: r }); },
    communicate: (r: ListRow) => setCommLists([r]),
    edit: (r: ListRow) => { returnTo.current = r.id; if (live && r.live) setBuilder({ mode: "edit", list: r }); else setView({ kind: "edit", list: r }); },
    changeOwner: setOwnerList,
    createSegment: (r: ListRow) => toast(`Create segment from ${r.name}`),
    remove: (r: ListRow) => askDelete([r.id], r.name),
    performance: () => onNavigate?.("commLogs"),
  };

  return (
    <>
      <PageHeader
        title="Manage Lists"
        count={t.loading ? null : t.total}
        meta={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {!live && (
              <p className="font-body text-xs text-muted">
                Need a new list?{" "}
                <button type="button" onClick={() => onNavigate?.("upload")}
                  className={`inline-flex min-h-[44px] items-center rounded font-semibold text-accent hover:underline sm:min-h-0 ${FOCUS_RING}`}>
                  Upload Raw Data
                </button>
              </p>
            )}
            <RefreshStamp touch at={t.refreshedAt} onRefresh={t.refresh} busy={t.loading} />
          </div>
        }
        actions={
          <>
            <div className="w-full sm:w-auto"><SearchBox touch placeholder="Search by" value={t.search} onChange={t.setSearch} /></div>
            {live
              ? <Button touch variant="solid" icon="plus" onClick={() => setBuilder({ mode: "create", list: null })}>New list</Button>
              : <IconButton touch icon="filter" label="Filter" active={t.activeFilters.length > 0} onClick={() => setFilterOpen(true)} />}
            <Menu align="right" touch
              items={[
                { label: "Download all as CSV", icon: "download", onClick: () => { exportRows(t.rows); toast("Download started"); } },
                { label: "Download selected", icon: "download", disabled: !t.selected.length, onClick: () => { exportRows(selectedRows); toast(`Downloading ${t.selected.length} list(s)`); } },
                { label: "Import contact", icon: "upload", disabled: live, onClick: () => onNavigate?.("upload") },
                { label: "Delete selected", icon: "trash", danger: true, disabled: !t.selected.length || selectionHasSystem, onClick: () => askDelete(t.selected, `${t.selected.length} list(s)`) },
              ]}
              trigger={(open, toggle) => (
                <Button touch popup expanded={open} iconRight="chevronDown" active={open} onClick={toggle}>Action</Button>
              )}
            />
          </>
        }
      />

      <FilterChips touch chips={toChips(t.filters, fields)} onRemove={t.removeFilter} onClear={t.clearFilters} />

      <BulkBar touch count={t.selected.length} onClear={() => t.setSelected([])}>
        <Button size="sm" touch icon="send" disabled={live} title={live ? "Sending to lists is not available yet" : undefined} onClick={() => setCommLists(selectedRows)}>Communicate</Button>
        <Button size="sm" touch icon="download" onClick={() => { exportRows(selectedRows); toast("Download started"); }}>Download</Button>
        <Button size="sm" touch variant="danger" icon="trash" disabled={selectionHasSystem}
          title={selectionHasSystem ? "The LMS list is a system list and can’t be deleted" : undefined}
          onClick={() => askDelete(t.selected, `${t.selected.length} list(s)`)}>Delete</Button>
      </BulkBar>

      <DataTable
        touch
        label="Lists"
        rowLabel={(r) => `list ${r.name}`}
        columns={columns}
        card={(r) => <ListCard row={r} onTags={setTagList} onCount={onCount} />}
        onSortTo={t.setSort}
        rows={t.rows}
        loading={t.loading}
        error={t.error}
        onRetry={t.refresh}
        minWidth={1180}
        selectable
        selected={t.selected}
        onSelect={t.setSelected}
        sort={t.sort}
        onSort={t.toggleSort}
        empty={filtered
          ? <EmptyState icon="search" title="No lists match" body="Nothing fits your search and filters. Clear them to see every list."
              action={{ label: "Clear search and filters", icon: "refresh", onClick: () => { t.setSearch(""); t.clearFilters(); } }} />
          : live
            ? <EmptyState icon="users" title="No saved lists yet" body="Create a list from VSAT filters to see how many people match."
                action={{ label: "New list", icon: "plus", onClick: () => setBuilder({ mode: "create", list: null }) }} />
            : <EmptyState icon="users" title="No lists yet" body="Upload a CSV of contacts to create your first list."
                action={{ label: "Upload Raw Data", icon: "upload", onClick: () => onNavigate?.("upload") }} />}
        rowActions={(r) => <RowMenu row={r} act={act} />}
      />

      <Pagination touch page={t.page} pages={t.pages} total={t.total} pageSize={t.pageSize} onPage={t.setPage} onPageSize={t.setPageSize} />

      <FilterPanel touch open={filterOpen} fields={fields} value={t.filters} onClose={() => setFilterOpen(false)} onApply={t.setFilters} />

      <TagDrawer list={tagList} onClose={() => setTagList(null)} onSaved={(m) => { toast(m); t.reload(); }} />
      <OwnerModal list={ownerList} options={opts.state} onRetryOptions={opts.reload} onClose={() => setOwnerList(null)} onSaved={(m) => { toast(m); t.reload(); }} />
      {!live && <CommunicateDrawer lists={commLists} onClose={() => setCommLists([])} onSent={(m) => { toast(m); t.setSelected([]); }} />}
      <ListBuilder open={!!builder} mode={builder?.mode ?? "create"} list={builder?.list ?? null} onClose={() => setBuilder(null)} onSaved={(m) => { toast(m); t.reload(); }} />

      <ConfirmDialog
        accessible
        open={!!confirm}
        pending={deleting}
        error={deleteError}
        title="Delete list?"
        body={live ? `${confirm?.label ?? ""} will be removed. It is only a saved filter; no person or VSAT record is deleted.` : `${confirm?.label ?? ""} will be removed. Leads inside the list are not deleted.`}
        onCancel={() => { if (!deleting) setConfirm(null); }}
        onConfirm={confirmDelete}
      />

      {toastNode}
    </>
  );
}
