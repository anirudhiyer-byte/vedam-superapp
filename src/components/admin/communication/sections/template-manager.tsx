"use client";

import { useRef, useState } from "react";
import {
  PageHeader, RefreshStamp, SearchBox, Button, Menu, Icon, LinkText, Dash,
  StatusPill, Modal, ConfirmDialog, FilterChips, FOCUS_RING, useToast,
} from "../ui/primitives";
import { DataTable, Pagination, useTableQuery, type Column } from "../ui/data-table";
import { FilterPanel, toChips, type FilterField } from "../ui/filter-panel";
import { Tabs, tabPanelProps } from "../ui/tabs";
import { EmptyState } from "../ui/states";
import { useOptions } from "../ui/use-options";
import { templatesApi } from "../lib/mock-api";
import type { DocStatus, DocTemplateRow, LandingEditor, LandingKind, LandingTemplateRow } from "../lib/types";
import { DocComposer, DocFieldsDrawer } from "./template-forms";
import { LandingWizard, type WizardTarget } from "./landing-wizard";

const rate = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

function RateCell({ value, color, empty }: { value: number; color: string; empty?: boolean }) {
  if (empty) return <Dash />;
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className="hidden h-1.5 w-10 overflow-hidden rounded-full bg-surface-warm sm:inline-block">
        <span className="block h-full rounded-full" style={{ width: `${value}%`, background: color }} />
      </span>
      <span className="w-9 text-right tabular-nums">{value}%</span>
    </span>
  );
}

/** The "⋮" button that opens a row menu. */
function KebabButton({ label, open, toggle }: { label: string; open: boolean; toggle: () => void }) {
  return (
    <button type="button" onClick={toggle} aria-label={label} aria-haspopup="menu" aria-expanded={open}
      className={`grid h-11 w-11 place-items-center rounded-lg transition-colors sm:h-8 sm:w-8 ${FOCUS_RING} ${open ? "bg-surface-warm text-accent" : "text-muted hover:bg-surface-warm hover:text-foreground"}`}>
      <Icon name="dotsV" className="h-4 w-4" />
    </button>
  );
}

function OptionsError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#7f2323] bg-[#3d1414]/40 px-3 py-2 font-body text-sm text-foreground">
      <span>{message}</span>
      <Button size="sm" touch icon="refresh" onClick={onRetry}>Try again</Button>
    </div>
  );
}

const DOC_TABS = ["All", "Active", "Inactive", "Draft", "Test Mode"] as const;
const LANDING_TABS = ["All", "Active", "Inactive", "Draft", "Enabled"] as const;

/** Filters the status tabs own are not shown as chips. */
const withoutStatus = (f: Record<string, string>) => Object.fromEntries(Object.entries(f).filter(([k]) => k !== "status"));

/* ══════════════════════════════════════════════════════
   MANAGE DOCUMENT TEMPLATES
   ══════════════════════════════════════════════════════ */
export function DocumentTemplates() {
  const t = useTableQuery<DocTemplateRow>({ fetcher: templatesApi.documents, pageSize: 10 });
  const { toast, toastNode } = useToast({ safe: true });
  const opts = useOptions(templatesApi.documentOptions);
  const [filterOpen, setFilterOpen] = useState(false);
  const [tab, setTab] = useState<(typeof DOC_TABS)[number]>("All");
  const [composer, setComposer] = useState<{ id: string | null } | null>(null);
  const [fieldsFor, setFieldsFor] = useState<DocTemplateRow | null>(null);
  const [generate, setGenerate] = useState<DocTemplateRow | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const fields: FilterField[] = [
    { kind: "select", key: "formName", placeholder: "Select Form", options: opts.options.formName ?? [] },
    { kind: "select", key: "docType", placeholder: "Select Template Type", options: opts.options.docType ?? [] },
    { kind: "daterange", key: "createdOn", placeholder: "Created On" },
    { kind: "daterange", key: "updatedOn", placeholder: "Updated On" },
  ];
  const chips = toChips(withoutStatus(t.filters), fields);
  const hasQuery = chips.length > 0 || !!t.search;

  const setStatusTab = (k: (typeof DOC_TABS)[number]) => { setTab(k); t.setFilters({ ...t.filters, status: k === "All" ? "" : k }); };
  const clearAll = () => { t.setSearch(""); t.setFilters({ ...(t.filters.status ? { status: t.filters.status } : {}) }); };

  const setStatus = async (r: DocTemplateRow, status: DocStatus) => {
    try {
      await templatesApi.documentSetStatus(r.id, status);
      toast(status === "Active" ? `${r.title} marked as active` : status === "Inactive" ? `${r.title} marked as inactive` : `Test mode enabled for ${r.title}`);
      t.reload();
    } catch (e) { toast(e instanceof Error && e.message ? e.message : "Could not change the status. Try again."); }
  };
  const copy = async (r: DocTemplateRow) => {
    try { await templatesApi.documentCopy(r.id); toast(`Copied ${r.title}`); t.reload(); }
    catch (e) { toast(e instanceof Error && e.message ? e.message : "Could not copy the template. Try again."); }
  };
  const runGenerate = async () => {
    if (!generate) return;
    setGenerating(true); setGenerateError(null);
    try { await templatesApi.documentGenerate(generate.id); toast("Application Print Template generated"); setGenerate(null); }
    catch (e) { setGenerateError(e instanceof Error && e.message ? e.message : "Could not generate the template. Try again."); }
    finally { setGenerating(false); }
  };

  const menuItems = (r: DocTemplateRow) => {
    if (r.system) {
      return [
        { label: "Show/Hide Field(s)", icon: "gear" as const, onClick: () => setFieldsFor(r) },
        { label: "Generate Application Print", icon: "doc" as const, onClick: () => { setGenerateError(null); setGenerate(r); } },
      ];
    }
    return [
      { label: "Edit Template", icon: "pencil" as const, onClick: () => setComposer({ id: r.id }) },
      { label: "Copy Template", icon: "copy" as const, onClick: () => copy(r) },
      ...(r.status !== "Active" ? [{ label: "Mark as active", icon: "check" as const, onClick: () => setStatus(r, "Active") }] : []),
      ...(r.status !== "Inactive" ? [{ label: "Mark as inactive", icon: "close" as const, onClick: () => setStatus(r, "Inactive") }] : []),
      ...(r.status !== "Test Mode" ? [{ label: "Enable Test Mode", icon: "shield" as const, onClick: () => setStatus(r, "Test Mode") }] : []),
    ];
  };
  const titleCell = (r: DocTemplateRow) =>
    r.system ? <span className="font-semibold text-heading">{r.title}</span> : <LinkText touch onClick={() => setComposer({ id: r.id })}>{r.title}</LinkText>;
  const dash = (v: string) => (v === "-" ? <Dash /> : v);

  const columns: Column<DocTemplateRow>[] = [
    { id: "title", header: "Templates Title", sortable: true, sticky: true, width: 220, cell: titleCell },
    { id: "formName", header: "Form Name", sortable: true, cell: (r) => dash(r.formName) },
    { id: "docType", header: "Document Type", sortable: true, cell: (r) => dash(r.docType) },
    { id: "sortOrder", header: "Sort Order", align: "right", sortable: true, cell: (r) => <span className="tabular-nums">{r.sortOrder}</span> },
    { id: "createdOn", header: "Created On", sortable: true, cell: (r) => dash(r.createdOn) },
    { id: "updatedOn", header: "Last Updated On", sortable: true, cell: (r) => dash(r.updatedOn) },
    { id: "status", header: "Status", sortable: true, cell: (r) => <StatusPill status={r.status} /> },
  ];

  return (
    <>
      <PageHeader
        title="Manage Document Templates"
        count={t.loading ? null : t.total}
        countLabel="Templates"
        meta={<RefreshStamp touch at={t.refreshedAt} onRefresh={t.refresh} busy={t.loading} />}
        actions={
          <>
            <div className="w-full sm:w-auto"><SearchBox touch placeholder="Search by Document Templates Title" value={t.search} onChange={t.setSearch} /></div>
            <Button touch icon="filter" active={chips.length > 0} onClick={() => setFilterOpen(true)}>Filter</Button>
            <Button touch variant="solid" icon="plus" onClick={() => setComposer({ id: null })}>Create</Button>
          </>
        }
      />

      {opts.state.status === "error" && <OptionsError message={opts.state.message} onRetry={opts.reload} />}
      <FilterChips touch chips={chips} onRemove={t.removeFilter} onClear={() => t.setFilters(t.filters.status ? { status: t.filters.status } : {})} />

      <div className="mb-4">
        <Tabs prefix="doc" label="Template status" cols={5} active={tab} onChange={setStatusTab}
          tabs={DOC_TABS.map((k) => ({ key: k, label: k }))} />
      </div>

      <div {...tabPanelProps("doc", tab)}>
        <DataTable
          touch label="Document templates" rowLabel={(r) => r.title}
          columns={columns} rows={t.rows} loading={t.loading} error={t.error} onRetry={t.refresh}
          minWidth={1060} sort={t.sort} onSort={t.toggleSort} onSortTo={t.setSort}
          empty={<EmptyState icon="doc" title="No document templates found"
            body={hasQuery || tab !== "All" ? "Try another status, template type or search." : "Create your first document template."}
            action={hasQuery ? { label: "Clear filters", icon: "close", onClick: clearAll } : { label: "Create", icon: "plus", onClick: () => setComposer({ id: null }) }} />}
          card={(r) => (
            <div className="min-w-0">
              <p className="break-words font-body text-sm font-semibold text-heading">{r.system ? r.title : titleCell(r)}</p>
              <p className="mt-1 font-body text-xs text-muted">Form: <span className="text-foreground">{r.formName === "-" ? "—" : r.formName}</span></p>
              <p className="mt-0.5 font-body text-xs text-muted">Type: <span className="text-foreground">{r.docType === "-" ? "—" : r.docType}</span> · Sort order: <span className="text-foreground">{r.sortOrder}</span></p>
              <p className="mt-0.5 font-body text-xs text-muted">Created: <span className="text-foreground">{r.createdOn === "-" ? "—" : r.createdOn}</span></p>
              <div className="mt-1.5"><StatusPill status={r.status} /></div>
            </div>
          )}
          rowActions={(r) => (
            <Menu align="right" touch items={menuItems(r)}
              trigger={(open, toggle) => <KebabButton label={`Actions for ${r.title}`} open={open} toggle={toggle} />} />
          )}
        />
      </div>

      <Pagination touch page={t.page} pages={t.pages} total={t.total} pageSize={t.pageSize} onPage={t.setPage} onPageSize={t.setPageSize} />
      <FilterPanel touch open={filterOpen} fields={fields} value={withoutStatus(t.filters)}
        onClose={() => setFilterOpen(false)} onApply={(next) => t.setFilters({ ...next, ...(t.filters.status ? { status: t.filters.status } : {}) })} />

      {composer && (
        <DocComposer id={composer.id} onClose={() => setComposer(null)}
          onSaved={(title, edited) => { setComposer(null); t.reload(); toast(`${title} ${edited ? "updated" : "saved"}`); }} />
      )}
      {fieldsFor && (
        <DocFieldsDrawer row={fieldsFor} formOptions={opts.options.formName ?? []} onClose={() => setFieldsFor(null)} onSaved={toast} />
      )}
      <ConfirmDialog accessible open={!!generate} title="Confirm" confirmLabel="Yes" pending={generating} error={generateError}
        body="Are you sure you want to generate the Application Print Template?"
        onConfirm={runGenerate} onCancel={() => !generating && setGenerate(null)} />
      {toastNode}
    </>
  );
}

/* ══════════════════════════════════════════════════════
   MANAGE LANDING TEMPLATES
   ══════════════════════════════════════════════════════ */
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

function EditorBadge({ editor }: { editor: LandingEditor }) {
  const html = editor === "HTML Uploader";
  return (
    <span className={`inline-flex items-center gap-1.5 font-body text-xs font-semibold ${html ? "text-[#4ade80]" : "text-[#fb923c]"}`}>
      <Icon name={html ? "code" : "grid"} className="h-3.5 w-3.5" />{editor}
    </span>
  );
}
function DeviceIcon({ device }: { device: LandingTemplateRow["device"] }) {
  return (
    <span className="inline-flex items-center gap-1 text-muted" title={device === "Both" ? "Mobile and Desktop" : device}>
      {device !== "Desktop" && <Icon name="smartphone" className="h-4 w-4" />}
      {device !== "Mobile" && <Icon name="monitor" className="h-4 w-4" />}
      <span className="sr-only">{device === "Both" ? "Mobile and Desktop" : device}</span>
    </span>
  );
}

export function LandingTemplates() {
  const t = useTableQuery<LandingTemplateRow>({ fetcher: templatesApi.landing, pageSize: 10 });
  const { toast, toastNode } = useToast({ safe: true });
  const opts = useOptions(templatesApi.landingOptions);
  const [filterOpen, setFilterOpen] = useState(false);
  const [tab, setTab] = useState<(typeof LANDING_TABS)[number]>("All");
  const [wizard, setWizard] = useState<WizardTarget | null>(null);
  const [preview, setPreview] = useState<LandingTemplateRow | null>(null);
  const [urlFor, setUrlFor] = useState<{ row: LandingTemplateRow; url: string | null; error: string | null } | null>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  const fields: FilterField[] = [
    { kind: "select", key: "form", placeholder: "Select Form", options: opts.options.form ?? [] },
    { kind: "select", key: "templateType", placeholder: "Select Template Type", options: opts.options.templateType ?? [] },
    { kind: "select", key: "device", placeholder: "Select Device Type", options: opts.options.device ?? [] },
    { kind: "daterange", key: "createdOn", placeholder: "Created On" },
    { kind: "daterange", key: "updatedOn", placeholder: "Updated On" },
  ];
  const chips = toChips(withoutStatus(t.filters), fields);
  const hasQuery = chips.length > 0 || !!t.search;
  const setStatusTab = (k: (typeof LANDING_TABS)[number]) => { setTab(k); t.setFilters({ ...t.filters, status: k === "All" ? "" : k }); };
  const keepStatus = (next: Record<string, string>) => ({ ...next, ...(t.filters.status ? { status: t.filters.status } : {}) });

  const open = (target: WizardTarget) => { returnTo.current = document.activeElement as HTMLElement | null; setWizard(target); window.scrollTo({ top: 0 }); };
  const close = (message?: string) => {
    setWizard(null);
    if (message) toast(message);
    t.reload();
    requestAnimationFrame(() => returnTo.current?.focus());
  };
  const create = (kind: LandingKind, editor: LandingEditor) => open({ kind, editor });

  const getUrl = async (r: LandingTemplateRow) => {
    setUrlFor({ row: r, url: null, error: null });
    try { const x = await templatesApi.landingGetUrl(r.id); setUrlFor({ row: r, url: x.url, error: null }); }
    catch (e) { setUrlFor({ row: r, url: null, error: e instanceof Error && e.message ? e.message : "Could not get the URL. Try again." }); }
  };
  const copyUrl = async (url: string) => {
    try { await navigator.clipboard.writeText(url); toast("URL copied"); }
    catch { toast("Could not copy automatically. Select the URL and copy it."); }
  };
  const gallery = async (r: LandingTemplateRow) => {
    try { await templatesApi.landingAddToGallery(r.id); toast(`${r.title} added to gallery`); }
    catch (e) { toast(e instanceof Error && e.message ? e.message : "Could not add to gallery. Try again."); }
  };

  const idCell = (r: LandingTemplateRow) => <LinkText touch onClick={() => open({ kind: r.templatePage, editor: r.editor, id: r.id })}>{r.id}</LinkText>;
  const columns: Column<LandingTemplateRow>[] = [
    { id: "id", header: "Id", sortable: true, width: 80, cell: idCell },
    { id: "title", header: "Title", sortable: true, sticky: true, width: 200, cell: (r) => <span className="font-semibold text-heading">{r.title}</span> },
    { id: "assignedForms", header: "Assigned Forms", sortable: true, cell: (r) => r.assignedForms },
    { id: "templatePage", header: "Page Type", sortable: true, cell: (r) => <span className="font-semibold text-accent-soft">{r.templatePage}</span> },
    { id: "editor", header: "Editor Type", sortable: true, cell: (r) => <EditorBadge editor={r.editor} /> },
    { id: "device", header: "Device", sortable: true, cell: (r) => <DeviceIcon device={r.device} /> },
    { id: "views", header: "Views", align: "right", sortable: true, cell: (r) => (r.views ? <span className="tabular-nums">{r.views.toLocaleString("en-IN")}</span> : <Dash />) },
    { id: "submits", header: "Submits", align: "right", sortable: true, cell: (r) => (r.submits ? <span className="tabular-nums">{r.submits.toLocaleString("en-IN")}</span> : <Dash />) },
    { id: "conv", header: "Conversion", align: "right", cell: (r) => <RateCell value={rate(r.submits, r.views)} color="#4ade80" empty={!r.views} /> },
    { id: "updatedOn", header: "Last Updated On", sortable: true, cell: (r) => r.updatedOn },
    { id: "status", header: "Status", sortable: true, cell: (r) => <StatusPill status={r.status} /> },
  ];

  return (
    <>
      {wizard && (
        <LandingWizard target={wizard} onBack={() => close()} onDone={(m) => close(m)} />
      )}
      <div hidden={!!wizard}>
        <PageHeader
          title="Manage Landing Templates"
          count={t.loading ? null : t.total}
          countLabel="Templates"
          meta={<RefreshStamp touch at={t.refreshedAt} onRefresh={t.refresh} busy={t.loading} />}
          actions={
            <>
              <div className="w-full sm:w-auto"><SearchBox touch placeholder="Search title" value={t.search} onChange={t.setSearch} /></div>
              <Button touch icon="filter" active={chips.length > 0} onClick={() => setFilterOpen(true)}>Filter</Button>
              <Menu align="right" touch
                items={[
                  { group: "Drag & Drop Builder", label: "Application Page", hint: "Embed a form for admissions & enrolment", icon: "grid", onClick: () => create("Application", "Drag & Drop") },
                  { group: "Drag & Drop Builder", label: "Marketing Page", hint: "Drive campaigns, events & programme leads", icon: "grid", onClick: () => create("Marketing", "Drag & Drop") },
                  { group: "Custom HTML", label: "Application Page ", hint: "Embed a form for admissions & enrolment", icon: "code", onClick: () => create("Application", "HTML Uploader") },
                  { group: "Custom HTML", label: "Marketing Page ", hint: "Drive campaigns, events & programme leads", icon: "code", onClick: () => create("Marketing", "HTML Uploader") },
                ]}
                trigger={(isOpen, toggle) => (
                  <Button touch variant="solid" icon="plus" iconRight="chevronDown" popup expanded={isOpen} onClick={toggle}>Create</Button>
                )} />
            </>
          }
        />

        {opts.state.status === "error" && <OptionsError message={opts.state.message} onRetry={opts.reload} />}
        <FilterChips touch chips={chips} onRemove={t.removeFilter} onClear={() => t.setFilters(keepStatus({}))} />

        <div className="mb-4">
          <Tabs prefix="land" label="Template status" cols={5} active={tab} onChange={setStatusTab}
            tabs={LANDING_TABS.map((k) => ({ key: k, label: k }))} />
        </div>

        <div {...tabPanelProps("land", tab)}>
          <DataTable
            touch label="Landing templates" rowLabel={(r) => r.title}
            columns={columns} rows={t.rows} loading={t.loading} error={t.error} onRetry={t.refresh}
            minWidth={1480} sort={t.sort} onSort={t.toggleSort} onSortTo={t.setSort}
            empty={<EmptyState icon="grid" title="No landing templates found"
              body={hasQuery || tab !== "All" ? "Try another status, device type or search." : "Use Create to add your first landing template."}
              action={hasQuery ? { label: "Clear filters", icon: "close", onClick: () => { t.setSearch(""); t.setFilters(keepStatus({})); } } : undefined} />}
            card={(r) => (
              <div className="min-w-0">
                <p className="break-words font-body text-sm font-semibold text-heading">{r.title}</p>
                <p className="mt-0.5 font-body text-xs text-muted">Id: {idCell(r)}</p>
                <p className="mt-0.5 font-body text-xs text-muted">Forms: <span className="text-foreground">{r.assignedForms}</span> · <span className="font-semibold text-accent-soft">{r.templatePage}</span></p>
                <p className="mt-1.5 flex flex-wrap items-center gap-3"><EditorBadge editor={r.editor} /><DeviceIcon device={r.device} /></p>
                <p className="mt-1 font-body text-xs text-muted">Updated: <span className="text-foreground">{r.updatedOn}</span></p>
                <div className="mt-1.5"><StatusPill status={r.status} /></div>
              </div>
            )}
            rowActions={(r) => (
              <Menu align="right" touch
                items={[
                  { group: "Manage", label: "Edit", icon: "pencil", onClick: () => open({ kind: r.templatePage, editor: r.editor, id: r.id }) },
                  { group: "View", label: "Preview", icon: "eye", onClick: () => setPreview(r) },
                  { group: "View", label: "Get URL", icon: "link", onClick: () => getUrl(r) },
                  { group: "Organize", label: "Add to gallery", icon: "image", onClick: () => gallery(r) },
                ]}
                trigger={(isOpen, toggle) => <KebabButton label={`Actions for ${r.title}`} open={isOpen} toggle={toggle} />} />
            )}
          />
        </div>

        <Pagination touch page={t.page} pages={t.pages} total={t.total} pageSize={t.pageSize} onPage={t.setPage} onPageSize={t.setPageSize} />
        <FilterPanel touch open={filterOpen} fields={fields} value={withoutStatus(t.filters)} onClose={() => setFilterOpen(false)} onApply={(next) => t.setFilters(keepStatus(next))} />
      </div>

      <Modal open={!!preview} title={preview ? `Preview — ${preview.title}` : "Preview"} onClose={() => setPreview(null)}
        footer={<Button variant="solid" touch onClick={() => setPreview(null)}>Close</Button>}>
        {preview && (
          <iframe title={`Preview of ${preview.title}`} sandbox="" className="block h-64 w-full rounded-lg bg-white"
            srcDoc={`<!doctype html><meta charset="utf-8"><style>body{font:14px/1.5 system-ui,sans-serif;color:#1c1c28;margin:20px}small{color:#666}</style><h2>${esc(preview.title)}</h2><p>${esc(preview.templatePage)} page · ${esc(preview.editor)} · ${esc(preview.device === "Both" ? "Mobile and Desktop" : preview.device)}</p><small>Sample preview — the live page is not loaded in this prototype.</small>`} />
        )}
      </Modal>
      <Modal open={!!urlFor} title={urlFor ? `Get URL — ${urlFor.row.title}` : "Get URL"} onClose={() => setUrlFor(null)}
        footer={<Button variant="ghost" touch onClick={() => setUrlFor(null)}>Close</Button>}>
        {urlFor && (urlFor.error ? (
          <div role="alert" className="grid gap-3">
            <p className="font-body text-sm text-[#f87171]">{urlFor.error}</p>
            <Button touch icon="refresh" onClick={() => getUrl(urlFor.row)}>Try again</Button>
          </div>
        ) : urlFor.url === null ? (
          <p role="status" className="font-body text-sm text-muted">Getting the URL…</p>
        ) : (
          <div className="grid gap-3">
            <label htmlFor="lp-url" className="font-body text-sm font-semibold text-heading">Page URL</label>
            <input id="lp-url" readOnly value={urlFor.url} onFocus={(e) => e.currentTarget.select()}
              className={`min-h-[44px] w-full rounded-lg border border-border bg-background px-3 py-2.5 font-mono text-xs text-foreground sm:min-h-0 ${FOCUS_RING}`} />
            <Button touch variant="solid" icon="copy" onClick={() => copyUrl(urlFor.url as string)}>Copy URL</Button>
          </div>
        ))}
      </Modal>
      {toastNode}
    </>
  );
}
