"use client";

import { useEffect, useRef, useState } from "react";
import { Drawer, Button, IconButton, Select, TextField } from "../../ui/primitives";
import { Field, RadioGroup } from "../../ui/form";
import { Stepper } from "../../ui/stepper";
import { InlineError } from "../../ui/states";
import { automationsApi } from "../../lib/mock-api";
import { CATEGORIES, CONDITION_FIELDS, CONDITION_OPS, MODULES, SKIPS_CONDITIONS, TRIGGERS, TRIGGER_CONFIG } from "./create-config";
import type { AutomationRow } from "../../lib/types";

const REQUIRED = "Field is required.";
const PICK = "Please select an option.";
type Cond = { field: string; op: string; value: string };
type Values = { category: string; trigger: string; triggerConfig: string; module: string; conditions: Cond[] };
type StepKey = "category" | "trigger" | "conditions" | "review";
type Errors = { triggerConfig?: string; module?: string; conditions?: { field?: string; op?: string; value?: string }[] };

const LABELS: Record<StepKey, string> = { category: "Category", trigger: "Trigger", conditions: "Conditions", review: "Review" };
const stepsFor = (trigger: string): StepKey[] => (SKIPS_CONDITIONS(trigger) ? ["category", "trigger", "review"] : ["category", "trigger", "conditions", "review"]);
const INITIAL: Values = { category: "Lead/Application", trigger: "On Creation", triggerConfig: "", module: "", conditions: [] };

/**
 * CREATE AUTOMATION — a wizard in a drawer: Category, Trigger, Conditions, Review.
 * Date and interval triggers skip Conditions. It creates a Draft and hands it back so the page can open its editor.
 */
export function CreateAutomationDrawer({ open, used, quota, onClose, onCreated }: {
  open: boolean; used: number | null; quota: number | null; onClose: () => void; onCreated: (row: AutomationRow) => void;
}) {
  return open ? <Body used={used} quota={quota} onClose={onClose} onCreated={onCreated} /> : null;
}

function Body({ used, quota, onClose, onCreated }: { used: number | null; quota: number | null; onClose: () => void; onCreated: (row: AutomationRow) => void }) {
  const [v, setV] = useState<Values>(INITIAL);
  const [step, setStep] = useState<StepKey>("category");
  const [errors, setErrors] = useState<Errors>({});
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const focusCond = useRef<number | "add" | null>(null);

  const steps = stepsFor(v.trigger);
  const index = steps.indexOf(step);
  const left = used !== null && quota !== null ? quota - used : null;
  const modules = MODULES[v.category] ?? [];
  const cfg = TRIGGER_CONFIG[v.trigger];

  // after Next / Back / edit, put focus on the new step's heading so keyboard and screen-reader users land there
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    headingRef.current?.focus();
  }, [step]);
  // after adding / removing a condition, keep focus inside the list
  useEffect(() => {
    const f = focusCond.current; focusCond.current = null;
    if (f === null) return;
    (f === "add" ? document.querySelector<HTMLElement>("[data-cond-add] button") : document.getElementById(`auto-cond-${f}-field`))?.focus();
  }, [v.conditions.length]);

  const patch = (p: Partial<Values>) => setV((x) => ({ ...x, ...p }));
  const setCond = (i: number, p: Partial<Cond>) => {
    setV((x) => ({ ...x, conditions: x.conditions.map((c, j) => (j === i ? { ...c, ...p } : c)) }));
    setErrors((e) => ({ ...e, conditions: e.conditions?.map((c, j) => (j === i ? {} : c)) }));
  };

  const validateStep = (): boolean => {
    if (step === "trigger" && cfg && !v.triggerConfig) {
      setErrors({ triggerConfig: PICK });
      document.getElementById("auto-trigger-config")?.focus();
      return false;
    }
    if (step === "conditions") {
      const conds = v.conditions.map((c) => ({ field: c.field ? undefined : PICK, op: c.op ? undefined : PICK, value: c.value.trim() ? undefined : REQUIRED }));
      const e: Errors = { module: v.module ? undefined : PICK, conditions: conds };
      setErrors(e);
      if (e.module) { document.getElementById("auto-module")?.focus(); return false; }
      const bad = conds.findIndex((c) => c.field || c.op || c.value);
      if (bad >= 0) {
        const c = conds[bad];
        document.getElementById(`auto-cond-${bad}-${c.field ? "field" : c.op ? "op" : "value"}`)?.focus();
        return false;
      }
    }
    setErrors({});
    return true;
  };

  const go = (to: StepKey) => { setErrors({}); setSubmitError(null); setStep(to); };
  const next = async () => {
    if (pending) return;
    if (!validateStep()) return;
    if (step !== "review") { go(steps[index + 1]); return; }
    setPending(true); setSubmitError(null);
    try {
      const row = await automationsApi.create({
        category: v.category, trigger: v.trigger, triggerConfig: v.triggerConfig || undefined,
        module: SKIPS_CONDITIONS(v.trigger) ? modules[0] ?? "Lead" : v.module,
        conditions: SKIPS_CONDITIONS(v.trigger) ? [] : v.conditions,
      });
      onCreated(row);
    } catch (e) {
      setSubmitError(e instanceof Error && e.message ? e.message : "We could not create the automation. Please try again.");
      setPending(false);
    }
  };
  const back = () => { if (index > 0) go(steps[index - 1]); else onClose(); };

  const heading = (text: string, sub?: string) => (
    <div className="mb-4">
      <h3 ref={headingRef} tabIndex={-1} className="font-display text-base font-bold text-heading outline-none">{text}</h3>
      {sub && <p className="mt-0.5 font-body text-sm text-muted">{sub}</p>}
    </div>
  );

  return (
    <Drawer open accessible size="lg" title="Create Automation" closeLabel="Close create automation"
      onClose={() => { if (!pending) onClose(); }}
      footer={
        <>
          <Button variant="ghost" touch disabled={pending} onClick={back}>{index === 0 ? "Cancel" : "Back"}</Button>
          <Button variant="solid" touch disabled={pending} onClick={next}>
            {step === "review" ? (pending ? "Creating…" : "Create Automation") : "Next"}
          </Button>
        </>
      }>
      <form noValidate onSubmit={(e) => { e.preventDefault(); next(); }}>
        {left !== null && quota !== null && (
          <p className="mb-4 rounded-lg border border-border bg-background px-3 py-2 font-mono text-[11px] text-foreground" aria-live="polite">
            Automations {used}/{quota} — {left} left
          </p>
        )}
        <Stepper compact steps={steps.map((s) => LABELS[s])} current={index} />

        {step === "category" && (
          <>
            {heading("Choose a category", "This decides which records the automation runs on.")}
            <RadioGroup name="auto-category" legend="Category" value={v.category} options={CATEGORIES}
              onChange={(c) => patch({ category: c, module: (MODULES[c] ?? []).includes(v.module) ? v.module : "" })} />
          </>
        )}

        {step === "trigger" && (
          <>
            {heading("Pick a trigger", "This decides when the automation starts.")}
            <div className="space-y-4">
              <RadioGroup name="auto-trigger" legend="Trigger" value={v.trigger} options={TRIGGERS}
                onChange={(t) => { patch({ trigger: t, triggerConfig: "" }); setErrors({}); }} />
              {cfg && (
                <Field id="auto-trigger-config" label={cfg.label} required stacked error={errors.triggerConfig}>
                  <Select id="auto-trigger-config" touch placeholder={cfg.placeholder} value={v.triggerConfig}
                    options={cfg.options.map((o) => ({ value: o, label: o }))}
                    invalid={!!errors.triggerConfig} describedBy={errors.triggerConfig ? "auto-trigger-config-error" : undefined}
                    onChange={(x) => { patch({ triggerConfig: x }); setErrors({}); }} />
                </Field>
              )}
            </div>
          </>
        )}

        {step === "conditions" && (
          <>
            {heading("Entry conditions", "Only records that match these conditions will enter the automation.")}
            <div className="space-y-4">
              <Field id="auto-module" label="Module" required stacked error={errors.module}>
                <Select id="auto-module" touch placeholder="Select module" value={v.module}
                  options={modules.map((m) => ({ value: m, label: m }))}
                  invalid={!!errors.module} describedBy={errors.module ? "auto-module-error" : undefined}
                  onChange={(x) => { patch({ module: x }); setErrors((e) => ({ ...e, module: undefined })); }} />
              </Field>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-body text-sm font-semibold text-heading">Conditions</p>
                <div className="flex items-center gap-2">
                  <Button size="sm" touch variant="ghost" icon="refresh" onClick={() => { patch({ module: "", conditions: [] }); setErrors({}); }}>Reset</Button>
                  <span data-cond-add>
                    <Button size="sm" touch icon="plus" onClick={() => { focusCond.current = v.conditions.length; patch({ conditions: [...v.conditions, { field: "", op: "is", value: "" }] }); }}>Add Condition</Button>
                  </span>
                </div>
              </div>

              {v.conditions.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center">
                  <p className="font-body text-sm font-semibold text-heading">Conditions are optional</p>
                  <p className="mt-1 font-body text-xs text-muted">Skip this to run for every record, or add a condition to narrow it down.</p>
                </div>
              ) : (
                <ul className="space-y-3">
                  {v.conditions.map((c, i) => {
                    const er = errors.conditions?.[i];
                    return (
                      <li key={i} className="rounded-lg border border-border bg-background p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <p className="font-mono text-[11px] font-semibold uppercase tracking-wide text-muted">Condition {i + 1}</p>
                          <IconButton touch icon="trash" label={`Remove condition ${i + 1}`}
                            onClick={() => { focusCond.current = v.conditions.length > 1 ? Math.max(0, i - 1) : "add"; patch({ conditions: v.conditions.filter((_, j) => j !== i) }); }} />
                        </div>
                        <div className="grid gap-3">
                          <Field id={`auto-cond-${i}-field`} label="Field" required stacked error={er?.field}>
                            <Select id={`auto-cond-${i}-field`} touch placeholder="Select field" value={c.field}
                              options={CONDITION_FIELDS.map((f) => ({ value: f, label: f }))}
                              invalid={!!er?.field} describedBy={er?.field ? `auto-cond-${i}-field-error` : undefined} onChange={(x) => setCond(i, { field: x })} />
                          </Field>
                          <Field id={`auto-cond-${i}-op`} label="Operator" required stacked error={er?.op}>
                            <Select id={`auto-cond-${i}-op`} touch placeholder="Select operator" value={c.op}
                              options={CONDITION_OPS.map((f) => ({ value: f, label: f }))}
                              invalid={!!er?.op} describedBy={er?.op ? `auto-cond-${i}-op-error` : undefined} onChange={(x) => setCond(i, { op: x })} />
                          </Field>
                          <Field id={`auto-cond-${i}-value`} label="Value" required stacked error={er?.value}>
                            <TextField id={`auto-cond-${i}-value`} touch placeholder="e.g. Applied" maxLength={60} value={c.value}
                              invalid={!!er?.value} describedBy={er?.value ? `auto-cond-${i}-value-error` : undefined} onChange={(x) => setCond(i, { value: x })} />
                          </Field>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        )}

        {step === "review" && (
          <>
            {heading("Review", "Check the details. You can change any of them before creating.")}
            <dl className="space-y-3">
              <ReviewRow label="Category" value={v.category} onEdit={() => go("category")} />
              <ReviewRow label="Configured trigger" value={cfg ? `${v.trigger} · ${v.triggerConfig}` : v.trigger} onEdit={() => go("trigger")} />
              {SKIPS_CONDITIONS(v.trigger) ? (
                <ReviewRow label="Entry conditions" value="Not used for this trigger" />
              ) : (
                <ReviewRow label="Entry conditions" onEdit={() => go("conditions")}
                  value={v.conditions.length ? v.conditions.map((c) => `${c.field} ${c.op} ${c.value}`).join(" AND ") : "None"}
                  extra={`Module: ${v.module}`} />
              )}
            </dl>
            <p className="mt-4 font-body text-xs text-muted">The automation is saved as a Draft. You open its workflow next and publish it from there.</p>
          </>
        )}

        {submitError && <div className="mt-4"><InlineError>{submitError}</InlineError></div>}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Drawer>
  );
}

function ReviewRow({ label, value, extra, onEdit }: { label: string; value: string; extra?: string; onEdit?: () => void }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-border bg-background p-3">
      <div className="min-w-0 flex-1">
        <dt className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</dt>
        <dd className="mt-0.5 break-words font-body text-sm font-semibold text-heading">{value}</dd>
        {extra && <dd className="mt-0.5 font-body text-xs text-muted">{extra}</dd>}
      </div>
      {onEdit && <IconButton touch icon="pencil" label={`Edit ${label.toLowerCase()}`} onClick={onEdit} />}
    </div>
  );
}
