"use client";

import { Icon } from "./primitives";

/**
 * In-page drill-down trail (v2): "Manage List › Import contacts". Items with an
 * onClick are links back up the trail; the last item is the current page.
 */
export function Breadcrumb({ items }: { items: { label: string; onClick?: () => void }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-2">
      <ol className="flex flex-wrap items-center gap-1 font-body text-sm text-muted">
        {items.map((it, i) => {
          const last = i === items.length - 1;
          return (
            <li key={it.label} className="flex items-center gap-1">
              {it.onClick && !last ? (
                <button type="button" onClick={it.onClick}
                  className="inline-flex min-h-[44px] items-center rounded px-1 font-semibold text-accent-soft hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-soft sm:min-h-0 sm:py-0.5">
                  {it.label}
                </button>
              ) : (
                <span aria-current={last ? "page" : undefined} className={last ? "px-1 font-semibold text-heading" : "px-1"}>{it.label}</span>
              )}
              {!last && <Icon name="chevronRight" className="h-3.5 w-3.5" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
