"use client";

import { useEffect, useMemo } from "react";
import { Drawer } from "../../ui/primitives";
import { ErrorState, Skeleton } from "../../ui/states";
import { useLoad } from "../../ui/use-load";
import { commLogsApi } from "../../lib/mock-api";
import type { CommLogRow, CommPreview } from "../../lib/types";

/** A short silent WAV, made in the browser, so the voice preview has something to play. Dummy only. */
function silentWav(sec: number): Blob {
  const rate = 8000, n = rate * sec, buf = new ArrayBuffer(44 + n), v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + n, true); w(8, "WAVEfmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, "data"); v.setUint32(40, n, true);
  new Uint8Array(buf, 44).fill(128);
  return new Blob([buf], { type: "audio/wav" });
}

function Voice({ p }: { p: CommPreview }) {
  const url = useMemo(() => URL.createObjectURL(silentWav(p.audioSec ?? 20)), [p.audioSec]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <div className="grid justify-items-center gap-2 py-4">
      <audio controls src={url} aria-label={`Voice message ${p.audioName}`} className="w-full max-w-sm" />
      <p className="font-mono text-xs text-muted">{p.audioName}</p>
      <p className="font-body text-xs text-muted">Silent sample for this preview.</p>
    </div>
  );
}

const Bubble = ({ lines }: { lines: string[] }) => (
  <div className="mx-auto max-w-sm rounded-xl bg-white px-4 py-3 text-[#111] shadow">
    {lines.map((l, i) => <p key={i} className={`font-body text-sm ${i ? "mt-2" : ""}`}>{l.replace(/\*/g, "")}</p>)}
  </div>
);

function Content({ p }: { p: CommPreview }) {
  return (
    <div>
      <p className="font-display text-base font-bold text-heading">{p.title} <span className="font-body text-sm font-normal text-muted">(v{p.version})</span></p>
      {p.kind === "email" && p.subject && <p className="mt-2 font-body text-sm text-foreground"><span className="font-mono text-[10px] uppercase text-muted">Subject </span>{p.subject}</p>}
      <div className="mt-4 rounded-xl bg-surface-warm/60 p-4">
        {p.kind === "amplify" ? <Voice p={p} /> : p.kind === "email"
          ? <div className="mx-auto max-w-md overflow-hidden rounded-xl bg-white text-[#111] shadow"><div className="bg-[#0B0826] px-4 py-3 font-mono text-[10px] uppercase tracking-wide text-white">Application upload</div><div className="grid gap-2 px-4 py-4">{p.lines.map((l, i) => <p key={i} className="font-body text-sm">{l}</p>)}</div></div>
          : <Bubble lines={p.lines} />}
      </div>
    </div>
  );
}

function Body({ row }: { row: CommLogRow }) {
  const { state, reload } = useLoad(() => commLogsApi.preview(row.id), "Could not load the preview.");
  if (state.status === "loading") return <div aria-busy="true" className="grid gap-3"><Skeleton className="h-5 w-40" /><Skeleton className="h-40" /></div>;
  if (state.status === "error") return <ErrorState title="Couldn’t load the preview" message={state.message} onRetry={reload} />;
  return <Content p={state.data} />;
}

/** Preview of what a job sent: WhatsApp bubble, e-mail, SMS or the Amplify voice file. Mounts fresh every time. */
export function PreviewDrawer({ row, onClose }: { row: CommLogRow | null; onClose: () => void }) {
  if (!row) return null;
  return <Drawer open accessible size="lg" title={`Preview · ${row.jobId}`} onClose={onClose}><Body row={row} /></Drawer>;
}
