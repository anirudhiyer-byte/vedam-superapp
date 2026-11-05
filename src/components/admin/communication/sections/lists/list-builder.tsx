"use client";

import { useEffect, useRef, useState } from "react";
import { Drawer, Button, TextField, Select, MultiSelect } from "../../ui/primitives";
import { Field } from "../../ui/form";
import { DateRangeField } from "../../ui/date-range-field";
import { InlineError, Skeleton } from "../../ui/states";
import type { ListRow } from "../../lib/types";
import {
  buildConditions, emptyListForm, formFromConditions, listBuilderApi, MULTI_KEYS, type AudiencePreview, type ListConditions,
  type ListFilterOptions, type ListForm,
} from "../../lib/live-lists";

export type BuilderMode = "create" | "edit" | "view";

const MULTI_LABEL: Record<(typeof MULTI_KEYS)[number], string> = {
  lead_stage: "Lead stage", application_stage: "Application stage", lead_source: "Lead source", campus: "Campus",
  state: "State", city: "City", grad_year: "Graduation year", utm_source: "UTM source", utm_campaign: "UTM campaign",
};
const YESNO = [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }];
const PAYMENT = [{ value: "paid", label: "Paid (VSAT fee received)" }, { value: "started_not_paid", label: "Started payment, not paid" }, { value: "not_paid", label: "Not paid" }];
const MAX_VALUES = 20;
const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

/**
 * Live Manage List drawer (Slice 3a): create a saved filter, edit one, or view its count.
 * Counts + a masked sample of 10 people only. Nothing is sent and no contact is shown in full.
 * The body mounts fresh every time it opens.
 */
export function ListBuilder({ mode, list, open, onClose, onSaved }: {
  mode: BuilderMode; list: ListRow | null; open: boolean; onClose: () => void; onSaved: (message: string) => void;
}) {
  return open ? <Body key={`${mode}-${list?.id ?? "new"}`} mode={mode} list={list} onClose={onClose} onSaved={onSaved} /> : null;
}

function Body({ mode, list, onClose, onSaved }: { mode: BuilderMode; list: ListRow | null; onClose: () => void; onSaved: (m: string) => void }) {
  const [name, setName] = useState(list?.name ?? "");
  const [form, setForm] = useState<ListForm>(() => (list?.conditions ? formFromConditions(list.conditions as ListConditions) : emptyListForm()));
  const [options, setOptions] = useState<ListFilterOptions | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ status: "idle" | "loading" | "ready" | "error"; data?: AudiencePreview; message?: string }>({ status: "idle" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const ticket = useRef(0);

  const editing = mode !== "view";
  const nameError = !name.trim() ? "Give the list a name." : name.trim().length > 80 ? "Use 80 characters or fewer." : null;
  const tooMany = MULTI_KEYS.find((k) => form[k].length > MAX_VALUES);
  const filterError = tooMany ? `${MULTI_LABEL[tooMany]}: pick up to ${MAX_VALUES} values.` : null;

  const loadOptions = () => {
    setOptionsError(null);
    listBuilderApi.filterOptions().then(setOptions).catch((e) => setOptionsError(errText(e, "Could not load the filter values.")));
  };
  const runPreview = () => {
    if (filterError) return;
    const mine = ++ticket.current;
    setPreview({ status: "loading" });
    listBuilderApi.preview(buildConditions(form))
      .then((data) => { if (mine === ticket.current) setPreview({ status: "ready", data }); })
      .catch((e) => { if (mine === ticket.current) setPreview({ status: "error", message: errText(e, "Could not count this audience.") }); });
  };
  useEffect(() => {
    if (editing) loadOptions(); else runPreview();
    // the cleanup must see the *latest* ticket on purpose: it invalidates any preview still in flight
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => { ticket.current++; };
    // run once when the drawer opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = <K extends keyof ListForm>(k: K, v: ListForm[K]) => { setForm((f) => ({ ...f, [k]: v })); setPreview({ status: "idle" }); };

  const save = async () => {
    setTried(true);
    if (nameError || filterError || saving) return;
    setSaving(true); setSaveError(null);
    try {
      const conditions = buildConditions(form);
      if (mode === "create") await listBuilderApi.create(name, conditions);
      else if (list) await listBuilderApi.update(list.id, { name: name.trim(), conditions });
      onSaved(mode === "create" ? `List “${name.trim()}” saved` : `List “${name.trim()}” updated`);
      onClose();
    } catch (e) {
      setSaveError(errText(e, "Could not save the list. Try again."));
    } finally {
      setSaving(false);
    }
  };

  const title = mode === "create" ? "New list" : mode === "edit" ? "Edit list" : `Count · ${list?.name ?? ""}`;
  return (
    <Drawer accessible size="lg" open title={title} onClose={onClose}
      footer={editing ? (
        <>
          <Button touch onClick={onClose}>Cancel</Button>
          <Button touch variant="solid" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save list"}</Button>
        </>
      ) : <Button touch onClick={onClose}>Close</Button>}>
      {editing && (
        <>
          <Field id="lb-name" label="List name" required stacked error={tried && nameError ? nameError : undefined}>
            <TextField touch id="lb-name" placeholder="e.g. Paid applicants, Pune" value={name} onChange={setName} maxLength={80}
              invalid={!!(tried && nameError)} describedBy={tried && nameError ? "lb-name-error" : undefined} />
          </Field>
          <p className="font-body text-xs text-muted">Who is in this list. Leave a filter empty to include everyone. People are matched when the list is used, so the count changes as data changes.</p>
          {optionsError ? (
            <div className="grid gap-1"><InlineError>{optionsError}</InlineError>
              <button type="button" onClick={loadOptions} className="w-fit font-body text-xs font-semibold text-accent-soft underline">Try again</button></div>
          ) : !options ? (
            <div className="grid gap-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {MULTI_KEYS.map((k) => options[k].length > 0 ? (
                <MultiSelect key={k} label={MULTI_LABEL[k]} options={options[k]} value={form[k]} onChange={(v) => set(k, v)} allLabel="Any" />
              ) : (
                <div key={k}><p className="mb-1.5 font-body text-sm font-semibold text-foreground">{MULTI_LABEL[k]}</p><p className="font-body text-xs text-muted">No values in the data yet.</p></div>
              ))}
              {(["vsat_registered", "exam_assigned", "exam_given", "consent_given"] as const).map((k) => (
                <Field key={k} id={`lb-${k}`} label={{ vsat_registered: "Registered for VSAT", exam_assigned: "Exam assigned", exam_given: "Exam given", consent_given: "Consent given" }[k]} stacked>
                  <Select touch id={`lb-${k}`} placeholder="Any" options={YESNO} value={form[k]} onChange={(v) => set(k, v as ListForm[typeof k])} />
                </Field>
              ))}
              <Field id="lb-payment" label="VSAT payment" stacked>
                <Select touch id="lb-payment" placeholder="Any" options={PAYMENT} value={form.payment} onChange={(v) => set("payment", v as ListForm["payment"])} />
              </Field>
              <div className="sm:col-span-2">
                <Field id="lb-signup" label="Signed up between" stacked>
                  <DateRangeField id="lb-signup" value={form.signup} onChange={(v) => set("signup", v)} />
                </Field>
              </div>
            </div>
          )}
          {filterError && <InlineError>{filterError}</InlineError>}
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <Button touch icon="eye" disabled={preview.status === "loading" || !!filterError} onClick={runPreview}>Preview audience</Button>
            {preview.status === "idle" && <span className="font-body text-xs text-muted">See how many people match before you save.</span>}
          </div>
        </>
      )}

      <PreviewBlock state={preview} onRetry={runPreview} />
      {saveError && <InlineError>{saveError}</InlineError>}
    </Drawer>
  );
}

function PreviewBlock({ state, onRetry }: { state: { status: string; data?: AudiencePreview; message?: string }; onRetry: () => void }) {
  if (state.status === "idle") return null;
  if (state.status === "loading") return <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-busy="true">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}</div>;
  if (state.status === "error") return (
    <div className="grid gap-1"><InlineError>{state.message}</InlineError>
      <button type="button" onClick={onRetry} className="w-fit font-body text-xs font-semibold text-accent-soft underline">Try again</button></div>
  );
  const d = state.data!;
  const n = (v: number) => v.toLocaleString("en-IN");
  return (
    <section aria-label="Audience preview" className="grid gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-live="polite">
        {[["People", d.total], ["With mobile", d.withPhone], ["With e-mail", d.withEmail], ["Consent given", d.consented]].map(([label, value]) => (
          <div key={label as string} className="rounded-xl border border-border bg-background px-3 py-2.5">
            <p className="font-body text-xs text-muted">{label}</p>
            <p className="font-display text-xl font-extrabold tabular-nums text-heading">{n(value as number)}</p>
          </div>
        ))}
      </div>
      <div>
        <p className="mb-1.5 font-body text-xs text-muted">Sample of the newest {d.sample.length} (masked). Full contacts are never shown here.</p>
        {d.sample.length === 0 ? <p className="font-body text-sm text-muted">Nobody matches these filters.</p> : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[320px] text-left font-body text-sm">
              <thead className="bg-surface-warm text-xs text-muted"><tr><th scope="col" className="px-3 py-2">Mobile</th><th scope="col" className="px-3 py-2">E-mail</th><th scope="col" className="px-3 py-2">Consent</th></tr></thead>
              <tbody>
                {d.sample.map((r, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-3 py-2 font-mono text-xs">{r.phone ?? "—"}</td>
                    <td className="px-3 py-2 font-mono text-xs">{r.email ?? "—"}</td>
                    <td className="px-3 py-2">{r.consent ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
