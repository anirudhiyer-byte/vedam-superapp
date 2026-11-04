"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Select, TextField, TextArea, useToast } from "../ui/primitives";
import { Field } from "../ui/form";
import { Breadcrumb } from "../ui/breadcrumb";
import { Stepper } from "../ui/stepper";
import { WizardFooter } from "../ui/wizard-footer";
import { EmptyState, ErrorState, InlineError, Skeleton } from "../ui/states";
import { useOptions } from "../ui/use-options";
import { useLoad } from "../ui/use-load";
import { templatesApi } from "../lib/mock-api";
import type { LandingBasics, LandingEditor, LandingKind } from "../lib/types";
import { SwitchRow } from "./template-forms";

/** The steps Meritto shows in its header. Marketing pages have no Thank You step. */
const STEPS_APP = ["Basic Information", "Select Template", "Upload CSS, JS", "Build Landing Page", "Thank You Page"] as const;
const STEPS_MKT = STEPS_APP.slice(0, 4);

export type WizardTarget = { kind: LandingKind; editor: LandingEditor; id?: string };
type Errors = Partial<Record<keyof LandingBasics, string>>;
type UrlCheck = { status: "idle" } | { status: "checking" } | { status: "ok" } | { status: "taken" } | { status: "error"; message: string };

const blank = (t: WizardTarget): LandingBasics => ({
  kind: t.kind, editor: t.editor, forms: [], device: "", name: "", tag: "", metaHead: "", metaTitle: "", metaKeywords: "", metaDescription: "",
  pageLoader: false, lazyLoad: false, domain: "", path: "",
});

function validate(b: LandingBasics): Errors {
  const e: Errors = {};
  if (b.kind === "Application" && !b.device) e.device = "Select a device type.";
  if (!b.name.trim()) e.name = "Enter a template name.";
  if (b.kind === "Marketing") {
    if (!b.domain) e.domain = "Select a domain.";
    if (!b.path.trim()) e.path = "Enter the page path.";
    else if (!/^[a-z0-9][a-z0-9-]{1,60}$/i.test(b.path.trim())) e.path = "Use letters, numbers and dashes only (2 or more characters).";
  }
  return e;
}
const ORDER: (keyof LandingBasics)[] = ["device", "name", "domain", "path"];

/**
 * ADD / EDIT LAYOUT TEMPLATE (in-page drill-down: breadcrumb + Back).
 * Only step 1 (Basic Information) was visible in Meritto without saving; steps 2–5 show a plain "not built yet" card.
 */
export function LandingWizard({ target, onBack, onDone }: {
  target: WizardTarget; onBack: () => void; onDone: (message: string) => void;
}) {
  const edit = !!target.id;
  const steps = target.kind === "Application" ? STEPS_APP : STEPS_MKT;
  const load = useLoad(() => (target.id ? templatesApi.landingDetail(target.id) : Promise.resolve(blank(target))), "Could not open this template.");
  const opts = useOptions(templatesApi.landingOptions);
  const { toast, toastNode } = useToast({ safe: true });

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<LandingBasics | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | undefined>(target.id);
  const [url, setUrl] = useState<UrlCheck>({ status: "idle" });
  const heading = useRef<HTMLHeadingElement>(null);
  const stepHeading = useRef<HTMLHeadingElement>(null);

  const b: LandingBasics | null = form ?? (edit ? (load.state.status === "ready" ? load.state.data : null) : blank(target));
  const set = (patch: Partial<LandingBasics>) => {
    setForm({ ...(b as LandingBasics), ...patch });
    const keys = Object.keys(patch) as (keyof LandingBasics)[];
    if (keys.some((k) => errors[k])) setErrors((e) => { const n = { ...e }; keys.forEach((k) => delete n[k]); return n; });
    if ("domain" in patch || "path" in patch) setUrl({ status: "idle" });
  };

  useEffect(() => { heading.current?.focus(); }, []);
  const firstRender = useRef(true);
  useEffect(() => { if (firstRender.current) { firstRender.current = false; return; } stepHeading.current?.focus(); }, [step]);

  const focusField = (k: string) => requestAnimationFrame(() => document.getElementById(`lw-${k}`)?.focus());
  const o = opts.options;
  const title = edit ? "Edit Layout Template" : "Add Layout Template";

  const saveAndNext = async () => {
    if (!b || saving) return;
    const e = validate(b);
    setErrors(e); setFormError(null);
    const first = ORDER.find((k) => e[k]);
    if (first) { focusField(first); return; }
    setSaving(true);
    try {
      const r = await templatesApi.landingSave(b, savedId);
      setSavedId(r.id);
      toast(savedId ? "Changes saved" : "Saved as draft");
      setStep(1);
    } catch (err) {
      const f = (err as { field?: keyof LandingBasics }).field;
      const msg = err instanceof Error && err.message ? err.message : "Could not save. Try again.";
      if (f) { setErrors({ [f]: msg }); focusField(f); } else setFormError(msg);
    } finally { setSaving(false); }
  };

  const check = async () => {
    if (!b) return;
    const e: Errors = {};
    if (!b.domain) e.domain = "Select a domain first.";
    if (!b.path.trim()) e.path = "Enter the page path first.";
    if (e.domain || e.path) { setErrors((x) => ({ ...x, ...e })); focusField(e.domain ? "domain" : "path"); return; }
    setUrl({ status: "checking" });
    try {
      const r = await templatesApi.landingCheckUrl(b.domain, b.path.trim());
      setUrl({ status: r.available ? "ok" : "taken" });
    } catch (err) {
      const f = (err as { field?: keyof LandingBasics }).field;
      const msg = err instanceof Error && err.message ? err.message : "Could not check the URL. Try again.";
      if (f) { setErrors((x) => ({ ...x, [f]: msg })); setUrl({ status: "idle" }); } else setUrl({ status: "error", message: msg });
    }
  };

  const err = (k: keyof LandingBasics) => errors[k];
  const dsc = (k: keyof LandingBasics) => (errors[k] ? `lw-${k}-error` : undefined);
  const last = step === steps.length - 1;

  return (
    <>
      <Breadcrumb items={[{ label: "Manage Landing Templates", onClick: onBack }, { label: title }]} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 ref={heading} tabIndex={-1} className="font-display text-xl font-extrabold tracking-tight text-heading outline-none">{title}</h1>
        <Button touch icon="chevronLeft" onClick={onBack}>Back</Button>
      </div>

      <div className="rounded-2xl border border-border bg-surface p-4 sm:p-6">
        <div className="lg:hidden"><Stepper steps={steps} current={step} compact /></div>
        <div className="hidden lg:block"><Stepper steps={steps} current={step} /></div>
        <h2 ref={stepHeading} tabIndex={-1} className="sr-only">{steps[step]}</h2>

        {step === 0 && (
          edit && load.state.status === "loading" ? (
            <div role="status" aria-label="Loading template" className="grid gap-4">
              {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-11 w-full" />)}
            </div>
          ) : edit && load.state.status === "error" ? (
            <ErrorState title="Couldn’t open this template" message={load.state.message} onRetry={load.reload} />
          ) : b ? (
            <form noValidate onSubmit={(ev) => { ev.preventDefault(); saveAndNext(); }}>
              <div className="grid max-w-3xl gap-4">
                {opts.state.status === "error" && (
                  <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#7f2323] bg-[#3d1414]/40 px-3 py-2 font-body text-sm text-foreground">
                    <span>{opts.state.message}</span>
                    <Button size="sm" touch icon="refresh" onClick={opts.reload}>Try again</Button>
                  </div>
                )}

                {target.kind === "Application" && (
                  <>
                    <fieldset className="grid gap-1.5 sm:grid-cols-[180px_1fr] sm:gap-4">
                      <legend className="sr-only">Select Forms</legend>
                      <span aria-hidden className="font-body text-sm font-semibold text-heading sm:pt-2.5">Select Forms</span>
                      <div className="grid gap-1.5">
                        {(o.form ?? []).length === 0 && <p className="font-body text-sm text-muted">No forms to show.</p>}
                        {(o.form ?? []).map((f) => {
                          const on = b.forms.includes(f.value);
                          return (
                            <label key={f.value} className={`flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 font-body text-sm focus-within:outline focus-within:outline-2 focus-within:outline-accent-soft ${on ? "border-accent bg-surface-warm/60 text-heading" : "border-border text-foreground hover:bg-surface-warm/30"}`}>
                              <input type="checkbox" checked={on} onChange={() => set({ forms: on ? b.forms.filter((x) => x !== f.value) : [...b.forms, f.value] })} className="h-4 w-4 accent-[#8A18FF]" />
                              {f.label}
                            </label>
                          );
                        })}
                        <p className="font-body text-xs text-muted">Leave empty to use it for all forms.</p>
                      </div>
                    </fieldset>
                    <Field id="lw-device" label="Device Type" required error={err("device")}>
                      <Select id="lw-device" touch placeholder="Select device type" options={o.device ?? []} value={b.device} disabled={edit}
                        invalid={!!err("device")} describedBy={dsc("device")} onChange={(v) => set({ device: v })} />
                      {edit && <p className="font-body text-xs text-muted">The device type cannot be changed after the template is created.</p>}
                    </Field>
                  </>
                )}

                <Field id="lw-name" label="Template Name" required error={err("name")}>
                  <TextField id="lw-name" touch placeholder="Enter Template Name" value={b.name} invalid={!!err("name")} describedBy={dsc("name")} onChange={(v) => set({ name: v })} />
                </Field>
                <Field id="lw-tag" label="Add Tag">
                  <TextField id="lw-tag" touch placeholder="Add tags to categorize your pages" value={b.tag} onChange={(v) => set({ tag: v })} />
                </Field>

                {target.kind === "Marketing" && (
                  <fieldset className="grid gap-1.5 sm:grid-cols-[180px_1fr] sm:gap-4">
                    <legend className="sr-only">URL (required)</legend>
                    <span aria-hidden className="font-body text-sm font-semibold text-heading sm:pt-2.5">URL<span className="text-[#f87171]"> *</span></span>
                    <div className="grid gap-1.5">
                      <div className="flex flex-col gap-2 lg:flex-row lg:items-start">
                        <span className="flex items-center gap-2 lg:flex-1">
                          <span className="font-mono text-xs text-muted">https://</span>
                          <span className="min-w-0 flex-1">
                            <Select id="lw-domain" touch ariaLabel="Domain" placeholder="Select Domain" options={o.domain ?? []} value={b.domain}
                              invalid={!!err("domain")} describedBy={dsc("domain")} onChange={(v) => set({ domain: v })} />
                          </span>
                        </span>
                        <span className="flex items-center gap-2 lg:flex-1">
                          <span aria-hidden className="font-mono text-xs text-muted">/</span>
                          <span className="min-w-0 flex-1">
                            <TextField id="lw-path" touch ariaLabel="Page path" placeholder="Enter path" value={b.path} invalid={!!err("path")} describedBy={dsc("path")} onChange={(v) => set({ path: v })} />
                          </span>
                          <span className="font-mono text-xs text-muted">.html</span>
                        </span>
                        <Button touch icon="check" disabled={url.status === "checking"} onClick={check}>{url.status === "checking" ? "Checking…" : "Check Availability"}</Button>
                      </div>
                      {err("domain") && <InlineError id="lw-domain-error">{err("domain")}</InlineError>}
                      {err("path") && <InlineError id="lw-path-error">{err("path")}</InlineError>}
                      <p aria-live="polite" className={`font-body text-xs font-semibold ${url.status === "ok" ? "text-[#4ade80]" : "text-[#f87171]"}`}>
                        {url.status === "ok" && "This URL is available."}
                        {url.status === "taken" && "This URL is already taken. Try another path."}
                        {url.status === "error" && url.message}
                      </p>
                    </div>
                  </fieldset>
                )}

                <Field id="lw-metaHead" label="Meta head attributes">
                  <TextArea id="lw-metaHead" touch rows={5} placeholder="Enter meta head attributes" value={b.metaHead} onChange={(v) => set({ metaHead: v })} />
                </Field>
                <Field id="lw-metaTitle" label="Meta Title">
                  <TextField id="lw-metaTitle" touch placeholder="Enter meta title" value={b.metaTitle} onChange={(v) => set({ metaTitle: v })} />
                </Field>
                <Field id="lw-metaKeywords" label="Meta Keywords">
                  <TextField id="lw-metaKeywords" touch placeholder="Enter meta keywords" value={b.metaKeywords} onChange={(v) => set({ metaKeywords: v })} />
                </Field>
                <Field id="lw-metaDescription" label="Meta Description">
                  <TextArea id="lw-metaDescription" touch rows={4} placeholder="Enter meta description" value={b.metaDescription} onChange={(v) => set({ metaDescription: v })} />
                </Field>
                <SwitchRow id="lw-loader" label="Page Loader" hint="Applicable on every page load" checked={b.pageLoader} onChange={(v) => set({ pageLoader: v })} />
                <SwitchRow id="lw-lazy" label="Image Lazy Load" hint="Applicable on all images" checked={b.lazyLoad} onChange={(v) => set({ lazyLoad: v })} />
              </div>
              <WizardFooter onBack={onBack} backLabel="Cancel" primaryLabel="Save and Next" pending={saving} error={formError} />
            </form>
          ) : null
        )}

        {step > 0 && (
          <div>
            <EmptyState icon="grid" title={steps[step]} body="This step has not been built yet. Your Basic Information is saved as a draft." />
            <form onSubmit={(ev) => { ev.preventDefault(); if (last) onDone(`${b?.name.trim() || "Template"} saved`); else setStep(step + 1); }}>
              <WizardFooter onBack={() => setStep(step - 1)} primaryLabel={last ? "Finish" : "Next"} />
            </form>
          </div>
        )}
      </div>
      {toastNode}
    </>
  );
}
