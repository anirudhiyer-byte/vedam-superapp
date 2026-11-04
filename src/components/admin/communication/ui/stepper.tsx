"use client";

import { Icon } from "./primitives";

/**
 * Wizard progress (v2). Display-only: steps are reached with Back / Next,
 * never by clicking the circles. Phones get a compact "Step n of N" bar
 * so nothing scrolls sideways.
 */
export function Stepper({ steps, current, compact }: {
  steps: readonly string[]; current: number;
  /** v2: always use the narrow "Step n of N" bar (for drawers and other tight spaces) */
  compact?: boolean;
}) {
  const pct = ((current + 1) / steps.length) * 100;
  return (
    <>
      {/* phone */}
      <div className={`mb-5 ${compact ? "" : "sm:hidden"}`} role="group" aria-label="Progress">
        <div className="flex items-baseline justify-between">
          <p className="font-body text-sm font-semibold text-heading">{steps[current]}</p>
          <p className="font-mono text-[11px] text-muted">Step {current + 1} of {steps.length}</p>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border" aria-hidden>
          <div className="h-full rounded-full bg-brand-gradient transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {/* tablet / desktop */}
      <ol aria-label="Progress" className={`mb-6 hidden items-center ${compact ? "" : "sm:flex"}`}>
        {steps.map((s, i) => {
          const done = i < current, on = i === current;
          return (
            <li key={s} aria-current={on ? "step" : undefined} className="flex flex-1 items-center last:flex-none">
              <span className="flex shrink-0 items-center gap-2">
                <span className={`grid h-8 w-8 place-items-center rounded-full font-mono text-xs font-bold ${
                  done ? "bg-[#0f3d29] text-[#4ade80]" : on ? "bg-brand-gradient text-white" : "border border-border text-muted"}`}>
                  {done ? <Icon name="check" className="h-3.5 w-3.5" /> : i + 1}
                </span>
                <span className={`whitespace-nowrap font-body text-sm font-semibold ${on ? "text-heading" : done ? "text-foreground" : "text-muted"}`}>
                  {s}
                  {done && <span className="sr-only"> (completed)</span>}
                </span>
              </span>
              {i < steps.length - 1 && <span aria-hidden className={`mx-3 h-px min-w-[24px] flex-1 ${done ? "bg-accent" : "bg-border"}`} />}
            </li>
          );
        })}
      </ol>
    </>
  );
}
