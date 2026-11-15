"use client";

import type { ReactNode } from "react";
import { InlineError } from "./states";

/**
 * Form building blocks (v2): a labelled field row with inline error, and an
 * on/off switch. Used by the wizard screens; reusable for later items.
 */

export function Field({ id, label, required, hint, error, children, stacked }: {
  id: string; label: string; required?: boolean; hint?: string; error?: string; children: ReactNode;
  /** label above the control at every width (for drawers and modals) */
  stacked?: boolean;
}) {
  return (
    <div className={stacked ? "grid gap-1.5" : "grid gap-1.5 sm:grid-cols-[180px_1fr] sm:items-start sm:gap-4"}>
      <label htmlFor={id} className={`font-body text-sm font-semibold text-heading ${stacked ? "" : "sm:pt-2.5"}`}>
        {label}
        {required && <span className="text-[#f87171]" aria-hidden> *</span>}
        {required && <span className="sr-only"> (required)</span>}
        {hint && <span className="ml-1 font-normal text-muted">{hint}</span>}
      </label>
      <div className="grid gap-1.5">
        {children}
        {error && <InlineError id={`${id}-error`}>{error}</InlineError>}
      </div>
    </div>
  );
}

/** Accessible switch. Label it with aria-labelledby so the whole row reads naturally. */
export function Switch({ checked, onChange, labelledBy, describedBy, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; labelledBy: string; describedBy?: string; disabled?: boolean;
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-labelledby={labelledBy} aria-describedby={describedBy}
      disabled={disabled} onClick={(e) => { e.stopPropagation(); onChange(!checked); }}
      className="relative grid h-11 w-14 shrink-0 place-items-center rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-soft disabled:opacity-40">
      <span className={`relative h-6 w-11 rounded-full transition-colors ${checked ? "bg-brand-gradient" : "bg-border"}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? "left-[22px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}

/** Accessible radio group. Each option is a 44px tall row; arrow keys come from the native radios. */
export function RadioGroup({ name, legend, value, onChange, options }: {
  name: string; legend: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string; hint?: string; disabled?: boolean }[];
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 font-body text-sm font-semibold text-heading">{legend}</legend>
      {options.map((o) => (
        <label key={o.value}
          className={`flex min-h-[44px] items-center gap-3 rounded-lg border px-3 py-2 font-body text-sm transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-accent-soft ${
            o.disabled ? "cursor-not-allowed border-border text-muted opacity-60" : `cursor-pointer ${value === o.value ? "border-accent bg-surface-warm/60 text-heading" : "border-border text-foreground hover:bg-surface-warm/30"}`}`}>
          <input type="radio" name={name} value={o.value} checked={value === o.value} disabled={o.disabled} onChange={() => onChange(o.value)} className="h-4 w-4 accent-[#8A18FF]" />
          <span className="min-w-0"><span className="font-semibold">{o.label}</span>{o.hint && <span className="block text-xs text-muted">{o.hint}</span>}</span>
        </label>
      ))}
    </fieldset>
  );
}
