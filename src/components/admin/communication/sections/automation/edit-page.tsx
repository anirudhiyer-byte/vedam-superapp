"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader, Button, IconButton, StatusPill, TextField } from "../../ui/primitives";
import { Breadcrumb } from "../../ui/breadcrumb";
import { EmptyState, ErrorState, InlineError, Skeleton } from "../../ui/states";
import { WorkflowCanvas } from "./workflow-canvas";
import { automationsApi, automationActionCount } from "../../lib/mock-api";
import type { AutomationDetail, AutomationRow } from "../../lib/types";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; detail: AutomationDetail };
const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/**
 * EDIT AUTOMATION WORKFLOW — drill-down page with a breadcrumb and Back.
 * Rename (pencil), Publish and Performance work; the workflow itself is read-only in this preview.
 */
export function EditAutomation({ id, name, onBack, onPerformance, onToast }: {
  id: string; name: string; onBack: () => void; onPerformance: (row: AutomationRow) => void; onToast: (m: string) => void;
}) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const fetchIt = useCallback(() => {
    setLoad({ status: "loading" });
    automationsApi.get(id)
      .then((detail) => setLoad({ status: "ready", detail }))
      .catch((e: unknown) => setLoad({ status: "error", message: errText(e, "We could not open this automation.") }));
  }, [id]);
  useEffect(fetchIt, [fetchIt]);

  const row = load.status === "ready" ? load.detail.row : null;
  const title = row?.name ?? name;

  return (
    <>
      <Breadcrumb items={[{ label: "Manage Automations", onClick: onBack }, { label: title }]} />
      <PageHeader title="Edit Automation Workflow" actions={<Button touch icon="chevronLeft" onClick={onBack}>Back to Manage Automations</Button>} />
      <section aria-busy={load.status === "loading"} className="rounded-2xl border border-border bg-surface p-4 sm:p-6">
        {load.status === "loading" ? (
          <div role="status"><span className="sr-only">Loading automation…</span>
            <Skeleton className="h-6 w-64" /><Skeleton className="mt-3 h-4 w-80 max-w-full" />
            <Skeleton className="mt-8 h-20" /><Skeleton className="mt-4 h-20" /><Skeleton className="mt-4 h-20" />
          </div>
        ) : load.status === "error" ? (
          <ErrorState title="Couldn’t open this automation" message={load.message} onRetry={fetchIt} />
        ) : (
          <Ready detail={load.detail} onPerformance={onPerformance} onToast={onToast}
            onChanged={(r) => setLoad({ status: "ready", detail: { ...load.detail, row: r } })} />
        )}
      </section>
    </>
  );
}

function Ready({ detail, onPerformance, onToast, onChanged }: {
  detail: AutomationDetail; onPerformance: (row: AutomationRow) => void; onToast: (m: string) => void; onChanged: (r: AutomationRow) => void;
}) {
  const { row, nodes } = detail;
  const actions = automationActionCount(nodes);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(row.name);
  const [nameError, setNameError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const pencil = useRef<HTMLDivElement>(null);
  const wasRenaming = useRef(false);

  // focus: into the field when renaming starts, back to the pencil when it ends
  useEffect(() => {
    if (renaming) { document.getElementById("auto-rename")?.focus(); wasRenaming.current = true; return; }
    if (wasRenaming.current) { wasRenaming.current = false; pencil.current?.querySelector("button")?.focus(); }
  }, [renaming]);

  const startRename = () => { setDraft(row.name); setNameError(undefined); setRenaming(true); };
  const saveName = async () => {
    if (saving) return;
    const n = draft.trim();
    if (!n) { setNameError("Field is required."); document.getElementById("auto-rename")?.focus(); return; }
    if (n === row.name) { setRenaming(false); return; }
    setSaving(true); setNameError(undefined);
    try {
      const r = await automationsApi.rename(row.id, n);
      onChanged(r); onToast(`Renamed to “${r.name}”`); setRenaming(false);
    } catch (e) {
      setNameError(errText(e, "We could not rename. Please try again."));
      document.getElementById("auto-rename")?.focus();
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    if (publishing) return;
    setPublishing(true); setPublishError(null);
    try {
      const r = await automationsApi.publish(row.id);
      onChanged(r); onToast(`“${r.name}” is now Active`);
    } catch (e) {
      setPublishError(errText(e, "We could not publish. Please try again."));
    } finally {
      setPublishing(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <form noValidate onSubmit={(e) => { e.preventDefault(); saveName(); }} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); if (!saving) setRenaming(false); } }}
              className="grid gap-2 sm:max-w-md">
              <label htmlFor="auto-rename" className="font-body text-sm font-semibold text-heading">Automation name</label>
              <TextField id="auto-rename" touch placeholder="Automation name" maxLength={80} value={draft}
                invalid={!!nameError} describedBy={nameError ? "auto-rename-error" : undefined}
                onChange={(v) => { setDraft(v); setNameError(undefined); }} />
              {nameError && <InlineError id="auto-rename-error">{nameError}</InlineError>}
              <div className="flex gap-2">
                <Button type="submit" variant="solid" touch disabled={saving}>{saving ? "Saving…" : "Save name"}</Button>
                <Button variant="ghost" touch disabled={saving} onClick={() => setRenaming(false)}>Cancel</Button>
              </div>
            </form>
          ) : (
            <div className="flex items-center gap-1">
              <h2 className="min-w-0 break-words font-display text-lg font-bold text-heading">{row.name}</h2>
              <div ref={pencil}><IconButton touch icon="pencil" label={`Rename ${row.name}`} onClick={startRename} /></div>
            </div>
          )}
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 font-body text-sm text-muted">
            <span className="font-mono text-xs">ID {row.id}</span>
            <span>Total Action Nodes: <span className="font-semibold text-foreground">{actions}</span></span>
            <StatusPill status={row.status} />
          </p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <Button touch icon="chart" onClick={() => onPerformance(row)}>Performance</Button>
          <Button touch variant="solid" icon="check" disabled={publishing || row.status === "Active"}
            title={row.status === "Active" ? "This automation is already active" : undefined} onClick={publish}>
            {publishing ? "Publishing…" : "Publish"}
          </Button>
        </div>
      </div>
      {publishError && <div className="mt-3"><InlineError>{publishError}</InlineError></div>}

      <h3 className="mb-3 mt-8 font-display text-base font-bold text-heading">Workflow</h3>
      {nodes.length === 0 ? (
        <EmptyState icon="flow" title="No steps yet" body="This automation has no trigger or actions." />
      ) : (
        <WorkflowCanvas nodes={nodes} />
      )}
      <p className="mt-6 font-body text-xs text-muted">Steps are read-only in this preview. Rename, Publish and Performance work.</p>
    </>
  );
}
