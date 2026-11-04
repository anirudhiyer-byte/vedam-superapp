"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PageHeader, SearchBox, IconButton, Button, FilterChips, ConfirmDialog, useToast } from "../ui/primitives";
import { useTableQuery } from "../ui/data-table";
import { FilterPanel, toChips, type FilterField } from "../ui/filter-panel";
import { Tabs, tabPanelProps } from "../ui/tabs";
import { InfoTip } from "../ui/info-tip";
import { EmptyState, ErrorState } from "../ui/states";
import { FlowCard, FlowCardSkeleton, type FlowActions } from "./flows/flow-card";
import { CategoryRail } from "./flows/category-rail";
import { PreviewDrawer } from "./flows/preview-drawer";
import { CreateFlowDrawer, type CreateRequest } from "./flows/create-flow-drawer";
import { flowsApi } from "../lib/mock-api";
import type { FlowRow } from "../lib/types";

type Scope = "recommended" | "mine";
const TABS: { key: Scope; label: string }[] = [{ key: "recommended", label: "Recommended" }, { key: "mine", label: "My Flow" }];
const STATUS: FilterField = {
  kind: "select", key: "status", label: "Status", placeholder: "Select Status",
  options: [{ value: "Active", label: "Active" }, { value: "Draft", label: "Draft" }],
};
const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/**
 * WHATSAPP FLOW (v2)
 * Recommended / My Flow tabs, a category rail (dropdown on phones), search and a Status filter.
 * Card menu: Preview (drawer with a phone picture) and Use (Create Flow drawer, pre-filled) for
 * Recommended; Preview, Duplicate, Active/Draft and Delete for My Flow. "Create" opens the same drawer.
 * The flow builder itself is not part of this build: Continue saves a Draft in My Flow.
 *
 * Data comes from `flowsApi` (lib/mock-api.ts) — swap that for the real endpoint.
 */
export function WhatsappFlow() {
  const t = useTableQuery<FlowRow>({ fetcher: flowsApi.list, pageSize: 100 });
  const { toast, toastNode } = useToast({ safe: true });

  const [scope, setScope] = useState<Scope>("recommended");
  const [category, setCategory] = useState<string | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [previewFlow, setPreviewFlow] = useState<FlowRow | null>(null);
  const [createReq, setCreateReq] = useState<CreateRequest>(null);
  const [confirm, setConfirm] = useState<FlowRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const focusAfterLoad = useRef<string | null>(null);

  const switchScope = (s: Scope) => { setScope(s); setCategory(null); t.setFilters({ ...t.filters, scope: s }); };

  const categories = useMemo(() => {
    const map = new Map<string, number>();
    t.rows.forEach((r) => map.set(r.category, (map.get(r.category) ?? 0) + 1));
    return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [t.rows]);
  // a deleted flow can empty the chosen category — fall back to All
  useEffect(() => { if (category && !t.loading && !categories.some(([c]) => c === category)) setCategory(null); }, [categories, category, t.loading]);

  // after create / duplicate, put keyboard focus on the new card's menu button
  useEffect(() => {
    if (t.loading || !focusAfterLoad.current) return;
    const el = document.querySelector<HTMLElement>(`[data-flow-actions="${focusAfterLoad.current}"]`);
    if (el) { el.focus(); focusAfterLoad.current = null; }
  }, [t.rows, t.loading]);

  const statusValue = useMemo(() => ({ status: t.filters.status ?? "" }), [t.filters.status]);
  const visible = category ? t.rows.filter((r) => r.category === category) : t.rows;
  const filtered = !!t.search || !!t.filters.status;
  const clearAll = () => { t.setSearch(""); t.setFilters({ scope }); setCategory(null); };

  const showInMine = (row: FlowRow) => {
    focusAfterLoad.current = row.id;
    if (scope === "mine") t.reload(); else switchScope("mine");
  };

  const act: FlowActions = {
    preview: setPreviewFlow,
    use: (f) => setCreateReq({ from: f }),
    duplicate: async (f) => {
      try { const row = await flowsApi.duplicate(f.id); toast(`Copied as “${row.name}” (Draft)`); showInMine(row); }
      catch (e) { toast(errText(e, "We could not copy the flow.")); }
    },
    toggleStatus: async (f) => {
      const next = f.status === "Active" ? "Draft" : "Active";
      try { await flowsApi.setStatus(f.id, next); toast(`${f.name} is now ${next}`); t.reload(); }
      catch (e) { toast(errText(e, "We could not change the status.")); }
    },
    remove: (f) => { setDeleteError(null); setConfirm(f); },
  };

  const confirmDelete = async () => {
    if (!confirm || deleting) return;
    setDeleting(true); setDeleteError(null);
    try {
      await flowsApi.remove(confirm.id);
      toast(`Deleted ${confirm.name}`);
      setConfirm(null); t.reload();
      // the card is gone, so land on the search box
      requestAnimationFrame(() => document.querySelector<HTMLInputElement>('input[aria-label="Search by flow name"]')?.focus());
    } catch (e) {
      setDeleteError(errText(e, "We could not delete the flow. Please try again."));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="WhatsApp Business Flow"
        titleExtra={
          <InfoTip label="About WhatsApp Business Flow">
            Flows are short forms that open inside WhatsApp, like collecting student details or booking a slot. Start from a Recommended flow or create your own; new flows are saved as Drafts.
          </InfoTip>
        }
        count={t.loading ? null : visible.length}
        countLabel={visible.length === 1 ? "Flow" : "Flows"}
        actions={
          <>
            <div className="w-full sm:w-auto"><SearchBox touch placeholder="Search by flow name" value={t.search} onChange={t.setSearch} /></div>
            <IconButton touch icon="filter" label="Filter" active={!!t.filters.status} onClick={() => setFilterOpen(true)} />
            <Button touch variant="solid" icon="plus" onClick={() => setCreateReq({})}>Create</Button>
          </>
        }
      />

      <div className="mb-4"><Tabs prefix="flows" label="Flow source" cols={2} tabs={TABS} active={scope} onChange={switchScope} /></div>

      <FilterChips touch chips={toChips(statusValue, [STATUS])} onRemove={t.removeFilter} onClear={() => t.setFilters({ scope })} />

      <div {...tabPanelProps("flows", scope)} className="grid gap-4 outline-none lg:grid-cols-[260px_1fr] lg:gap-5">
        <CategoryRail total={t.rows.length} categories={categories} active={category} onChange={setCategory} />

        <div aria-busy={t.loading} className="min-w-0">
          {t.loading ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <span className="sr-only">Loading flows…</span>
              {Array.from({ length: 3 }).map((_, i) => <FlowCardSkeleton key={i} />)}
            </div>
          ) : t.error ? (
            <ErrorState title="Couldn’t load flows" message={t.error} onRetry={t.refresh} />
          ) : visible.length === 0 ? (
            filtered ? (
              <EmptyState icon="search" title="No flows match" body="Nothing fits your search and filter. Clear them to see every flow in this tab."
                action={{ label: "Clear search and filter", icon: "refresh", onClick: clearAll }} />
            ) : scope === "mine" ? (
              <EmptyState icon="flow" title="No Flow Found" body="You have not made a flow yet. Create one, or use a flow from Recommended."
                action={{ label: "Create flow", icon: "plus", onClick: () => setCreateReq({}) }} />
            ) : (
              <EmptyState icon="flow" title="No recommended flows yet" body="Ready-made flows will show here. You can still create your own."
                action={{ label: "Create flow", icon: "plus", onClick: () => setCreateReq({}) }} />
            )
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label={`${scope === "mine" ? "My" : "Recommended"} flows`}>
              {visible.map((f) => <li key={f.id} className="flex"><div className="w-full"><FlowCard flow={f} act={act} /></div></li>)}
            </ul>
          )}
        </div>
      </div>

      <FilterPanel touch open={filterOpen} fields={[STATUS]} value={statusValue}
        onClose={() => setFilterOpen(false)} onApply={(f) => t.setFilters({ ...f, scope })} />

      <PreviewDrawer flow={previewFlow} onClose={() => setPreviewFlow(null)} />

      <CreateFlowDrawer request={createReq} onClose={() => setCreateReq(null)}
        onCreated={(row) => { setCreateReq(null); toast(`Flow “${row.name}” created as a Draft`); showInMine(row); }} />

      <ConfirmDialog
        accessible
        open={!!confirm}
        pending={deleting}
        error={deleteError}
        title="Delete flow?"
        body={`${confirm?.name ?? ""} will be removed from My Flow. Messages already sent are not affected.`}
        onCancel={() => { if (!deleting) setConfirm(null); }}
        onConfirm={confirmDelete}
      />

      {toastNode}
    </>
  );
}
