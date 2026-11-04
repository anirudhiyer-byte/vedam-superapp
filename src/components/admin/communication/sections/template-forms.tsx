"use client";

import { useMemo, useRef, useState } from "react";
import { Drawer, Button, Icon, Select, TextField, Modal, FOCUS_RING, type IconName } from "../ui/primitives";
import { Field, Switch } from "../ui/form";
import { EmptyState, ErrorState, InlineError, Skeleton } from "../ui/states";
import { useOptions } from "../ui/use-options";
import { useLoad } from "../ui/use-load";
import { useIsPhone } from "../ui/use-media";
import { templatesApi } from "../lib/mock-api";
import type { DocFieldStage, DocTemplateForm, DocTemplateRow, Option } from "../lib/types";

/* ══════════════════════════════════════════════════════
   SMALL FORM PARTS (shared with the Landing wizard)
   ══════════════════════════════════════════════════════ */

/** Two big radio buttons (Portrait / Landscape, PDF / Web View). Native radios, so arrow keys work. */
export function ChoiceGroup<T extends string>({ name, legend, value, onChange, options }: {
  name: string; legend: string; value: T; onChange: (v: T) => void;
  options: { value: T; label: string; icon: IconName }[];
}) {
  return (
    <fieldset className="grid gap-1.5">
      <legend className="mb-1.5 font-body text-sm font-semibold text-heading">{legend}</legend>
      <div className="grid grid-cols-2 gap-2">
        {options.map((o) => {
          const on = value === o.value;
          return (
            <label key={o.value}
              className={`flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-lg border px-3 py-2 font-body text-sm font-semibold transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent-soft ${
                on ? "border-accent bg-surface-warm text-accent" : "border-border text-muted hover:bg-surface-warm hover:text-foreground"}`}>
              <input type="radio" name={name} value={o.value} checked={on} onChange={() => onChange(o.value)} className="sr-only" />
              <Icon name={o.icon} className="h-4 w-4 shrink-0" />
              {o.label}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Same row look as the Landing wizard's toggles: label + hint on the left, switch on the right. */
export function SwitchRow({ id, label, hint, checked, onChange }: {
  id: string; label: string; hint: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-1">
      <div className="min-w-0 py-2">
        <p id={`${id}-l`} className="font-body text-sm font-semibold text-heading">{label}</p>
        <p id={`${id}-h`} className="font-body text-xs text-muted">{hint}</p>
      </div>
      <Switch checked={checked} onChange={onChange} labelledBy={`${id}-l`} describedBy={`${id}-h`} />
    </div>
  );
}

const TOOLS: { label: string; text: string; open: string; close: string; ph?: string }[] = [
  { label: "Bold", text: "B", open: "<strong>", close: "</strong>" },
  { label: "Italic", text: "I", open: "<em>", close: "</em>" },
  { label: "Strikethrough", text: "S", open: "<s>", close: "</s>" },
  { label: "Bulleted list", text: "•", open: "<ul><li>", close: "</li></ul>", ph: "item" },
  { label: "Numbered list", text: "1.", open: "<ol><li>", close: "</li></ol>", ph: "item" },
  { label: "Link", text: "Link", open: '<a href="https://">', close: "</a>", ph: "link text" },
];

/**
 * "Design your Template" — a small HTML editor: toolbar buttons wrap the selected text in tags,
 * and Preview shows the result in a sandboxed frame (no scripts run). Meritto's editor is a full
 * rich-text editor; this one is deliberately simpler.
 */
export function HtmlEditor({ id, value, onChange, invalid, describedBy, label }: {
  id: string; value: string; onChange: (v: string) => void; invalid?: boolean; describedBy?: string; label: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const wrap = (t: (typeof TOOLS)[number]) => {
    const el = ref.current;
    if (!el) return;
    const a = el.selectionStart, b = el.selectionEnd;
    const sel = value.slice(a, b) || t.ph || "text";
    onChange(value.slice(0, a) + t.open + sel + t.close + value.slice(b));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + t.open.length, a + t.open.length + sel.length); });
  };
  const doc = `<!doctype html><meta charset="utf-8"><style>body{font:14px/1.5 system-ui,sans-serif;color:#1c1c28;margin:16px}</style>${value}`;
  return (
    <div className={`overflow-hidden rounded-lg border bg-background ${invalid ? "border-[#f87171]" : "border-border focus-within:border-accent"}`}>
      <div role="toolbar" aria-label={`${label} tools`} className="flex flex-wrap items-center gap-1 border-b border-border bg-surface px-2 py-1.5">
        {TOOLS.map((t) => (
          <button key={t.label} type="button" aria-label={t.label} title={t.label} disabled={mode === "preview"} onClick={() => wrap(t)}
            className={`min-h-[44px] min-w-[44px] rounded-md px-2 font-body text-sm font-bold text-foreground hover:bg-surface-warm disabled:opacity-40 sm:min-h-8 sm:min-w-8 ${FOCUS_RING}`}>
            {t.text}
          </button>
        ))}
        <span className="ml-auto flex gap-1" role="group" aria-label="Editor view">
          {(["edit", "preview"] as const).map((m) => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}
              className={`min-h-[44px] rounded-md px-3 font-body text-xs font-semibold sm:min-h-8 ${FOCUS_RING} ${mode === m ? "bg-surface-warm text-accent" : "text-muted hover:text-foreground"}`}>
              {m === "edit" ? "Source" : "Preview"}
            </button>
          ))}
        </span>
      </div>
      {mode === "edit" ? (
        <textarea id={id} ref={ref} rows={9} value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false}
          aria-invalid={invalid || undefined} aria-describedby={describedBy} placeholder="<p>Dear {{lead.full_name}},</p>"
          className="block w-full resize-y bg-transparent px-3 py-2.5 font-mono text-xs text-foreground outline-none placeholder:text-muted" />
      ) : (
        <iframe title={`${label} preview`} sandbox="" srcDoc={doc} className="block h-56 w-full bg-white" />
      )}
    </div>
  );
}

const EMPTY_DOC: DocTemplateForm = {
  title: "", docType: "", docSubType: "", formName: "", html: "", size: "A4 (297 x 210 mm)", tokenFormat: "",
  orientation: "Portrait", showAs: "PDF", sortOrder: "", makeDefault: "No",
};

/** Paper sizes, drawn to scale (A0 is the biggest sheet). */
function SizeChart({ open, onClose }: { open: boolean; onClose: () => void }) {
  const sizes: [string, number, number][] = [["A0", 1189, 841], ["A1", 841, 594], ["A2", 594, 420], ["A3", 420, 297], ["A4", 297, 210], ["A5", 210, 148]];
  return (
    <Modal open={open} title="Size chart" onClose={onClose} footer={<Button variant="solid" touch onClick={onClose}>Close</Button>}>
      <p className="mb-3 font-body text-sm text-muted">Each sheet is half the area of the one before it. Sizes are in millimetres.</p>
      <ul className="grid gap-2">
        {sizes.map(([n, w, h]) => (
          <li key={n} className="flex items-center gap-3 font-body text-sm text-foreground">
            <span aria-hidden className="grid shrink-0 place-items-center rounded border border-accent/60 bg-surface-warm" style={{ width: Math.max(18, (w / 1189) * 120), height: Math.max(12, (h / 1189) * 120) }} />
            <span className="font-semibold text-heading">{n}</span>
            <span className="text-muted">{w} × {h} mm</span>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

/* ══════════════════════════════════════════════════════
   ADD / EDIT DOCUMENT TEMPLATE
   ══════════════════════════════════════════════════════ */
type Errors = Partial<Record<keyof DocTemplateForm, string>>;
const ORDER: (keyof DocTemplateForm)[] = ["title", "docType", "formName", "html", "sortOrder"];

function validate(d: DocTemplateForm): Errors {
  const e: Errors = {};
  if (!d.title.trim()) e.title = "Enter a template title.";
  if (!d.docType) e.docType = "Select a document type.";
  if (!d.formName) e.formName = "Select a form.";
  if (!d.html.replace(/<[^>]*>/g, "").trim()) e.html = "Design your template before saving.";
  if (d.sortOrder && !/^\d{1,4}$/.test(d.sortOrder)) e.sortOrder = "Sort order must be a whole number (0 to 9999).";
  return e;
}

/** Mount it when the drawer should open, unmount it to close. `id` null = add. */
export function DocComposer({ id, onClose, onSaved }: {
  id: string | null; onClose: () => void; onSaved: (title: string, edited: boolean) => void;
}) {
  const edit = id !== null;
  const load = useLoad(() => (id ? templatesApi.documentDetail(id) : Promise.resolve(EMPTY_DOC)), "Could not load this template.");
  const opts = useOptions(templatesApi.documentOptions);
  const [form, setForm] = useState<DocTemplateForm | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [chart, setChart] = useState(false);

  const d: DocTemplateForm | null = form ?? (edit ? (load.state.status === "ready" ? load.state.data : null) : EMPTY_DOC);
  const set = (patch: Partial<DocTemplateForm>) => {
    setForm({ ...(d as DocTemplateForm), ...patch });
    const keys = Object.keys(patch) as (keyof DocTemplateForm)[];
    if (keys.some((k) => errors[k])) setErrors((e) => { const n = { ...e }; keys.forEach((k) => delete n[k]); return n; });
  };
  const o = opts.options;
  const focusField = (k: string) => requestAnimationFrame(() => document.getElementById(`doc-${k}`)?.focus());

  const save = async () => {
    if (!d || saving) return;
    const e = validate(d);
    setErrors(e); setSaveError(null);
    const first = ORDER.find((k) => e[k]);
    if (first) { focusField(first); return; }
    setSaving(true);
    try {
      await templatesApi.documentSave(d, id ?? undefined);
      onSaved(d.title.trim(), edit);
    } catch (err) {
      const f = (err as { field?: keyof DocTemplateForm }).field;
      const msg = err instanceof Error && err.message ? err.message : "Could not save the template. Try again.";
      if (f) { setErrors({ [f]: msg }); focusField(f); } else setSaveError(msg);
      setSaving(false);
    }
  };

  const err = (k: keyof DocTemplateForm) => errors[k];
  const dsc = (k: keyof DocTemplateForm) => (errors[k] ? `doc-${k}-error` : undefined);

  return (
    <>
      <Drawer open accessible size="lg" title={edit ? "Edit Document Template" : "Add Document Template"} onClose={onClose}
        footer={
          <>
            <Button variant="ghost" touch disabled={saving} onClick={onClose}>Cancel</Button>
            <Button variant="solid" touch disabled={!d || saving} onClick={save}>{saving ? "Saving…" : "Save"}</Button>
          </>
        }>
        {edit && load.state.status === "loading" ? (
          <div role="status" aria-label="Loading template" className="grid gap-4">
            {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-11 w-full" />)}
          </div>
        ) : edit && load.state.status === "error" ? (
          <ErrorState title="Couldn’t open this template" message={load.state.message} onRetry={load.reload} />
        ) : d ? (
          <form noValidate onSubmit={(ev) => { ev.preventDefault(); save(); }} className="grid gap-4">
            {opts.state.status === "error" && (
              <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#7f2323] bg-[#3d1414]/40 px-3 py-2 font-body text-sm text-foreground">
                <span>{opts.state.message}</span>
                <Button size="sm" touch icon="refresh" onClick={opts.reload}>Try again</Button>
              </div>
            )}
            <Field id="doc-title" label="Template Title" required stacked error={err("title")}>
              <TextField id="doc-title" touch placeholder="Enter Template title" value={d.title} invalid={!!err("title")} describedBy={dsc("title")}
                onChange={(v) => set({ title: v })} />
            </Field>
            <Field id="doc-docType" label="Select Document Type" required stacked error={err("docType")}>
              <Select id="doc-docType" touch placeholder="Select Document Type" options={o.docType ?? []} value={d.docType} disabled={edit}
                invalid={!!err("docType")} describedBy={dsc("docType")} onChange={(v) => set({ docType: v, docSubType: v === "General Documents" ? d.docSubType : "" })} />
            </Field>
            {d.docType === "General Documents" && (
              <Field id="doc-docSubType" label="Select Document Sub-Type" stacked>
                <Select id="doc-docSubType" touch placeholder="Select Document Sub-Type" options={o.docSubType ?? []} value={d.docSubType} onChange={(v) => set({ docSubType: v })} />
              </Field>
            )}
            <Field id="doc-formName" label="Select Form" required stacked error={err("formName")}>
              <Select id="doc-formName" touch placeholder="Choose your forms" options={o.formName ?? []} value={d.formName}
                invalid={!!err("formName")} describedBy={dsc("formName")} onChange={(v) => set({ formName: v })} />
            </Field>
            <Field id="doc-html" label="Design your Template" required stacked error={err("html")}>
              <HtmlEditor id="doc-html" label="Design your Template" value={d.html} invalid={!!err("html")} describedBy={dsc("html")} onChange={(v) => set({ html: v })} />
              <p className="font-body text-xs text-muted">Use tags like <span className="font-mono text-foreground">{"{{lead.full_name}}"}</span> — they are filled in when the document is made.</p>
            </Field>
            <Field id="doc-size" label="Document Size" stacked>
              <Select id="doc-size" touch placeholder="Select Document Size" options={o.size ?? []} value={d.size} onChange={(v) => set({ size: v })} />
              <button type="button" onClick={() => setChart(true)}
                className={`justify-self-start rounded font-body text-xs font-semibold text-accent-soft hover:underline min-h-[44px] sm:min-h-0 ${FOCUS_RING}`}>Size Chart?</button>
            </Field>
            {edit && (
              <Field id="doc-tokenFormat" label="Token Format" stacked>
                <Select id="doc-tokenFormat" touch placeholder="Select Format" options={o.tokenFormat ?? []} value={d.tokenFormat} onChange={(v) => set({ tokenFormat: v })} />
              </Field>
            )}
            <ChoiceGroup name="doc-orientation" legend="Template Orientation" value={d.orientation} onChange={(v) => set({ orientation: v })}
              options={[{ value: "Portrait", label: "Portrait", icon: "smartphone" }, { value: "Landscape", label: "Landscape", icon: "monitor" }]} />
            <ChoiceGroup name="doc-showAs" legend="Show as" value={d.showAs} onChange={(v) => set({ showAs: v })}
              options={[{ value: "PDF", label: "PDF", icon: "doc" }, { value: "Web View", label: "Web View", icon: "monitor" }]} />
            <Field id="doc-sortOrder" label="Template Sort Order" stacked error={err("sortOrder")}>
              <TextField id="doc-sortOrder" touch placeholder="Sort Order" value={d.sortOrder} invalid={!!err("sortOrder")} describedBy={dsc("sortOrder")}
                onChange={(v) => set({ sortOrder: v })} />
            </Field>
            <Field id="doc-makeDefault" label="Make Default" required stacked>
              <Select id="doc-makeDefault" touch placeholder="Select" options={[{ value: "No", label: "No" }, { value: "Yes", label: "Yes" }]} value={d.makeDefault}
                onChange={(v) => set({ makeDefault: (v || "No") as "No" | "Yes" })} />
            </Field>
            {saveError && <InlineError>{saveError}</InlineError>}
          </form>
        ) : null}
      </Drawer>
      <SizeChart open={chart} onClose={() => setChart(false)} />
    </>
  );
}

/* ══════════════════════════════════════════════════════
   FIELD(S) CONFIGURATION — which form fields print on the Application Print PDF
   ══════════════════════════════════════════════════════ */
type FieldsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; saved: DocFieldStage[]; stages: DocFieldStage[] };

export function DocFieldsDrawer({ row, formOptions, onClose, onSaved }: {
  row: DocTemplateRow; formOptions: Option[]; onClose: () => void; onSaved: (message: string) => void;
}) {
  const phone = useIsPhone();
  const [form, setForm] = useState("");
  const [state, setState] = useState<FieldsState>({ status: "idle" });
  const [stage, setStage] = useState("");
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState<"save" | "exit" | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const ticket = useRef(0);

  const load = (f: string) => {
    setForm(f); setQ(""); setSaveError(null);
    if (!f) { setState({ status: "idle" }); return; }
    const mine = ++ticket.current;
    setState({ status: "loading" });
    templatesApi.documentFields(f)
      .then((s) => { if (mine === ticket.current) { setState({ status: "ready", saved: s, stages: s.map((x) => ({ ...x, fields: x.fields.map((y) => ({ ...y })) })) }); setStage(s[0]?.id ?? ""); } })
      .catch((e: unknown) => { if (mine === ticket.current) setState({ status: "error", message: e instanceof Error && e.message ? e.message : "Could not load the fields." }); });
  };

  const stages = useMemo(() => (state.status === "ready" ? state.stages : []), [state]);
  const dirty = state.status === "ready" && JSON.stringify(state.stages) !== JSON.stringify(state.saved);
  const current = stages.find((s) => s.id === stage) ?? stages[0];
  const query = q.trim().toLowerCase();
  const results = useMemo(
    () => (query ? stages.flatMap((s) => s.fields.filter((f) => f.label.toLowerCase().includes(query)).map((f) => ({ ...f, stage: s.name }))) : []),
    [query, stages],
  );
  const visible = query ? results : (current?.fields.map((f) => ({ ...f, stage: current.name })) ?? []);

  const toggle = (id: string, on: boolean) => state.status === "ready" && setState({ ...state, stages: state.stages.map((s) => ({ ...s, fields: s.fields.map((f) => (f.id === id ? { ...f, on } : f)) })) });
  const allOn = visible.length > 0 && visible.every((f) => f.on);
  const toggleAll = (on: boolean) => {
    if (state.status !== "ready") return;
    const ids = new Set(visible.map((f) => f.id));
    setState({ ...state, stages: state.stages.map((s) => ({ ...s, fields: s.fields.map((f) => (ids.has(f.id) ? { ...f, on } : f)) })) });
  };

  const save = async (exit: boolean) => {
    if (state.status !== "ready" || saving) return;
    setSaving(exit ? "exit" : "save"); setSaveError(null);
    try {
      await templatesApi.documentFieldsSave(form, state.stages);
      onSaved("Field settings saved");
      if (exit) onClose();
      else { setState({ ...state, saved: state.stages.map((s) => ({ ...s, fields: s.fields.map((f) => ({ ...f })) })) }); setSaving(null); }
    } catch (e) {
      setSaveError(e instanceof Error && e.message ? e.message : "Could not save. Try again.");
      setSaving(null);
    }
  };

  return (
    <Drawer open accessible size="lg" title={`${row.title} Field(s) Configuration`} onClose={onClose}
      footer={
        <>
          <Button touch disabled={!dirty || !!saving} onClick={() => save(false)}>{saving === "save" ? "Saving…" : "Save"}</Button>
          <Button variant="solid" touch disabled={!dirty || !!saving} onClick={() => save(true)}>{saving === "exit" ? "Saving…" : "Save & Exit"}</Button>
        </>
      }>
      <p className="font-body text-sm text-muted">Choose which fields are printed on the Application Print PDF.</p>
      <Field id="df-form" label="Select Form" stacked>
        <Select id="df-form" touch placeholder="Select Form" options={formOptions} value={form} onChange={load} />
      </Field>

      {state.status === "idle" && (
        <EmptyState icon="doc" title="Select a form" body="Please select a Form from the filter to view its Form Stage Field(s)." />
      )}
      {state.status === "loading" && (
        <div role="status" aria-label="Loading fields" className="grid gap-2">
          {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-11 w-full" />)}
        </div>
      )}
      {state.status === "error" && <ErrorState title="Couldn’t load the fields" message={state.message} onRetry={() => load(form)} />}

      {state.status === "ready" && (
        <>
          <Field id="df-search" label="Search by field name" stacked>
            <TextField id="df-search" touch placeholder="Search by field name" value={q} onChange={setQ} />
          </Field>
          <div className={phone || query ? "grid gap-3" : "grid grid-cols-[150px_minmax(0,1fr)] gap-3"}>
            {!query && (phone ? (
              <Field id="df-stage" label="Stage" stacked>
                <Select id="df-stage" touch placeholder="Select stage" options={stages.map((s) => ({ value: s.id, label: s.name }))} value={current?.id ?? ""} onChange={(v) => v && setStage(v)} />
              </Field>
            ) : (
              <nav aria-label="Form stages" className="grid h-fit gap-1">
                {stages.map((s) => (
                  <button key={s.id} type="button" aria-current={s.id === current?.id ? "true" : undefined} onClick={() => setStage(s.id)}
                    className={`rounded-lg px-3 py-2 text-left font-body text-sm transition-colors ${FOCUS_RING} ${s.id === current?.id ? "bg-surface-warm font-semibold text-heading" : "text-muted hover:bg-surface-warm/50 hover:text-foreground"}`}>
                    {s.name}
                  </button>
                ))}
              </nav>
            ))}
            <section aria-label={query ? "Search results" : current?.name} className="min-w-0">
              {visible.length === 0 ? (
                <EmptyState icon="search" title="No field matches" body="Try a different name." />
              ) : (
                <>
                  <div className="flex items-center justify-between border-b border-border">
                    <h3 className="font-body text-sm font-semibold text-heading">Field(s)</h3>
                    <span className="flex items-center gap-1 font-body text-xs text-muted">
                      <span id="df-all">Select All</span>
                      <Switch checked={allOn} onChange={toggleAll} labelledBy="df-all" />
                    </span>
                  </div>
                  <ul>
                    {visible.map((f) => (
                      <li key={f.id} className="flex items-center justify-between gap-2 border-b border-border/60">
                        <span className="min-w-0 py-2 font-body text-sm text-foreground">
                          <span id={`${f.id}-l`}>{f.label}</span>
                          {query && <span className="block text-xs text-muted">{f.stage}</span>}
                        </span>
                        <Switch checked={f.on} onChange={(v) => toggle(f.id, v)} labelledBy={`${f.id}-l`} />
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          </div>
          {saveError && <InlineError>{saveError}</InlineError>}
        </>
      )}
    </Drawer>
  );
}
