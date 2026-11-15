"use client";

import { Button, Modal } from "../../ui/primitives";
import { EmptyState, ErrorState, Skeleton } from "../../ui/states";
import { useLoad } from "../../ui/use-load";
import { commLogsApi } from "../../lib/mock-api";
import type { CommLogRow } from "../../lib/types";

function Body({ row }: { row: CommLogRow }) {
  const { state, reload } = useLoad(() => commLogsApi.statusDetail(row.id), "Could not load the status details.");
  if (state.status === "loading") return <div aria-busy="true" className="grid gap-2"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div>;
  if (state.status === "error") return <ErrorState title="Couldn’t load status details" message={state.message} onRetry={reload} />;
  if (!state.data.length) return <EmptyState icon="info" title="No status details" body="This job has nothing to report." />;
  return (
    <div className="max-h-[50dvh] overflow-auto rounded-xl border border-border" role="region" aria-label="Status details" tabIndex={0}>
      <table className="w-full min-w-[320px] border-collapse text-left font-body text-xs">
        <caption className="sr-only">Status details for {row.jobId}</caption>
        <thead className="sticky top-0 bg-surface-warm"><tr><th scope="col" className="px-3 py-2 font-semibold text-heading">Status</th><th scope="col" className="px-3 py-2 font-semibold text-heading">Date</th></tr></thead>
        <tbody>{state.data.map((d) => <tr key={d.id} className="border-t border-border"><td className="px-3 py-2 text-foreground">{d.status}</td><td className="whitespace-nowrap px-3 py-2 text-muted">{d.date}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

/** The ⓘ next to a status. Mounts fresh each time, so it always loads again. */
export function StatusDetail({ row, onClose }: { row: CommLogRow | null; onClose: () => void }) {
  if (!row) return null;
  return <Modal open title="Status Detail" onClose={onClose} footer={<Button touch onClick={onClose}>Close</Button>}><Body row={row} /></Modal>;
}
