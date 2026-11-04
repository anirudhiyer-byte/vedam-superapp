"use client";

import { Dash } from "../../ui/primitives";

/** Small tag pills. In the table `max` keeps the row short; the phone card shows them all. */
export function TagChips({ tags, max }: { tags?: string[]; max?: number }) {
  if (!tags?.length) return <Dash />;
  const shown = max ? tags.slice(0, max) : tags;
  const hidden = tags.length - shown.length;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {shown.map((t) => <span key={t} className="rounded-md bg-surface-warm px-2 py-0.5 font-mono text-[11px] font-semibold text-accent-soft">{t}</span>)}
      {hidden > 0 && <span title={tags.slice(max).join(", ")} className="font-mono text-[11px] text-muted"><span aria-hidden>+{hidden}</span><span className="sr-only">and {hidden} more: {tags.slice(max).join(", ")}</span></span>}
    </span>
  );
}
