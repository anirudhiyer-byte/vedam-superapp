"use client";

import { Button, Icon } from "../../ui/primitives";
import { fmt } from "./constants";
import type { Done } from "./use-wizard";

/** Success state after "Start import". Nothing is really imported — this is the mock. */
export function DoneStep({ done, onAgain, onBack, backLabel }: {
  done: Done; onAgain: () => void; onBack?: () => void; backLabel: string;
}) {
  return (
    <div className="grid place-items-center px-2 py-8 text-center" role="status">
      <span className="grid h-14 w-14 place-items-center rounded-full bg-[#0f3d29] text-[#4ade80]"><Icon name="check" className="h-7 w-7" /></span>
      <h2 className="mt-4 font-display text-xl font-extrabold text-heading">Import queued</h2>
      <p className="mt-1 max-w-md font-body text-sm text-muted">
        {fmt(done.rows)} rows are being added to <span className="font-semibold text-foreground">{done.listName}</span>. You can leave this page.
      </p>
      <dl className="mt-5 grid w-full max-w-md grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border text-left">
        {[["Job ID", done.jobId], ["Columns imported", String(done.imported)], ["Rows in file", fmt(done.rows)], ["Tag", done.tag || "—"]].map(([k, v]) => (
          <div key={k} className="bg-background p-3">
            <dt className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted">{k}</dt>
            <dd className="mt-0.5 break-words font-body text-sm font-semibold text-heading">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-6 flex w-full max-w-md flex-col gap-2 sm:flex-row sm:justify-center">
        {onBack && <Button touch variant="outline" onClick={onBack}>{backLabel}</Button>}
        <Button touch variant="solid" icon="upload" onClick={onAgain}>Upload another file</Button>
      </div>
    </div>
  );
}
