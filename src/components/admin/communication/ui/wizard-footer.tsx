"use client";

import { Button } from "./primitives";
import { InlineError } from "./states";

/**
 * Footer for a wizard card (v2). On phones the buttons stack full-width with the
 * primary action on top; from sm up they sit in one row. Put it inside the <form>
 * so Enter submits.
 */
export function WizardFooter({ onBack, backLabel = "Back", backDisabled, primaryLabel, pending, primaryDisabled, extra, hint, error }: {
  onBack?: () => void; backLabel?: string; backDisabled?: boolean;
  primaryLabel: string; pending?: boolean; primaryDisabled?: boolean;
  extra?: React.ReactNode; hint?: string; error?: string | null;
}) {
  return (
    <div className="mt-8 border-t border-border pt-5">
      {error && <div className="mb-3"><InlineError>{error}</InlineError></div>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
          {onBack && <Button variant="ghost" touch disabled={backDisabled || pending} onClick={onBack}>{backLabel}</Button>}
          {hint && <p className="font-body text-xs text-muted sm:ml-2" aria-live="polite">{hint}</p>}
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
          {extra}
          <Button type="submit" variant="solid" touch disabled={primaryDisabled || pending}>
            {pending ? "Please wait…" : primaryLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
