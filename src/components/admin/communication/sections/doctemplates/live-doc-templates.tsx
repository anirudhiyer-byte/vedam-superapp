"use client";

/**
 * Slice 4 · Manage Document Templates on LIVE data (behind DOC_TEMPLATES_LIVE; off = the old sample page).
 * Admin only (checked in the database). Create / edit open the editor; delete is a soft delete after a confirm.
 */
import { useState } from "react";
import { PageHeader, RefreshStamp, SearchBox, Button, Menu, Icon, LinkText, ConfirmDialog, FOCUS_RING, useToast } from "../../ui/primitives";
import { DataTable, Pagination, useTableQuery, type Column } from "../../ui/data-table";
import { EmptyState } from "../../ui/states";
import { docTemplatesApi, fmtSize, type DocTemplateLiveRow } from "../../lib/live-doc-templates";
import { DocTemplateEditor } from "./doc-editor";

function Fields({ list }: { list: string[] }) {
  if (!list.length) return <span className="text-muted">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {list.map((f) => <span key={f} className="rounded-md bg-surface-warm px-1.5 py-0.5 font-mono text-[11px] text-foreground">{`{{${f}}}`}</span>)}
    </span>
  );
}

export function LiveDocTemplates() {
  const t = useTableQuery<DocTemplateLiveRow>({ fetcher: docTemplatesApi.list, pageSize: 10 });
  const { toast, toastNode } = useToast({ safe: true });
  const [editor, setEditor] = useState<{ id: string | null } | null>(null);
  const [removing, setRemoving] = useState<DocTemplateLiveRow | null>(null);
  const [pending, setPending] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const remove = async () => {
    if (!removing) return;
    setPending(true); setRemoveError(null);
    try { await docTemplatesApi.remove(removing.id); toast(`${removing.name} deleted`); setRemoving(null); t.reload(); }
    catch (e) { setRemoveError(e instanceof Error ? e.message : "Could not delete the template. Try again."); }
    finally { setPending(false); }
  };

  const nameCell = (r: DocTemplateLiveRow) => <LinkText touch onClick={() => setEditor({ id: r.id })}>{r.name}</LinkText>;
  const columns: Column<DocTemplateLiveRow>[] = [
    { id: "name", header: "Template Name", sticky: true, width: 240, cell: nameCell },
    { id: "mergeFields", header: "Merge Fields", cell: (r) => <Fields list={r.mergeFields} /> },
    { id: "size", header: "Size", align: "right", cell: (r) => <span className="tabular-nums">{fmtSize(r.size)}</span> },
    { id: "owner", header: "Created By", cell: (r) => r.owner },
    { id: "createdOn", header: "Created On", cell: (r) => r.createdOn },
    { id: "updatedOn", header: "Last Updated On", cell: (r) => r.updatedOn },
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
            <div className="w-full sm:w-auto"><SearchBox touch placeholder="Search by template name" value={t.search} onChange={t.setSearch} /></div>
            <Button touch variant="solid" icon="plus" onClick={() => setEditor({ id: null })}>Create</Button>
          </>
        }
      />

      <DataTable
        touch label="Document templates" rowLabel={(r) => r.name}
        columns={columns} rows={t.rows} loading={t.loading} error={t.error} onRetry={t.refresh}
        minWidth={900} sort={t.sort} onSort={t.toggleSort} onSortTo={t.setSort}
        empty={<EmptyState icon="doc" title="No document templates found"
          body={t.search ? "Try another search." : "Create your first document template."}
          action={t.search ? { label: "Clear search", icon: "close", onClick: () => t.setSearch("") } : { label: "Create", icon: "plus", onClick: () => setEditor({ id: null }) }} />}
        card={(r) => (
          <div className="min-w-0">
            <p className="break-words font-body text-sm font-semibold text-heading">{nameCell(r)}</p>
            <div className="mt-1 font-body text-xs text-muted"><Fields list={r.mergeFields} /></div>
            <p className="mt-1 font-body text-xs text-muted">Size: <span className="text-foreground">{fmtSize(r.size)}</span> · By: <span className="text-foreground">{r.owner}</span></p>
            <p className="mt-0.5 font-body text-xs text-muted">Updated: <span className="text-foreground">{r.updatedOn}</span></p>
          </div>
        )}
        rowActions={(r) => (
          <Menu align="right" touch
            items={[
              { label: "Edit Template", icon: "pencil", onClick: () => setEditor({ id: r.id }) },
              { label: "Delete", icon: "trash", danger: true, onClick: () => { setRemoveError(null); setRemoving(r); } },
            ]}
            trigger={(open, toggle) => (
              <button type="button" onClick={toggle} aria-label={`Actions for ${r.name}`} aria-haspopup="menu" aria-expanded={open}
                className={`grid h-11 w-11 place-items-center rounded-lg transition-colors sm:h-8 sm:w-8 ${FOCUS_RING} ${open ? "bg-surface-warm text-accent" : "text-muted hover:bg-surface-warm hover:text-foreground"}`}>
                <Icon name="dotsV" className="h-4 w-4" />
              </button>
            )} />
        )}
      />
      <Pagination touch page={t.page} pages={t.pages} total={t.total} pageSize={t.pageSize} onPage={t.setPage} onPageSize={t.setPageSize} />

      {editor && (
        <DocTemplateEditor id={editor.id} onClose={() => setEditor(null)}
          onSaved={(name, edited) => { setEditor(null); t.reload(); toast(`${name} ${edited ? "updated" : "saved"}`); }} />
      )}
      <ConfirmDialog accessible open={!!removing} title="Delete template" confirmLabel="Delete" pending={pending} error={removeError}
        body={removing ? `Delete "${removing.name}"? It will no longer be listed.` : ""}
        onConfirm={remove} onCancel={() => !pending && setRemoving(null)} />
      {toastNode}
    </>
  );
}
