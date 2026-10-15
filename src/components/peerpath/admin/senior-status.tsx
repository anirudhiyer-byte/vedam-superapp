"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { adminSetStatus } from "@/lib/peerpath/client";
import type { SeniorStatus } from "@/lib/peerpath/types";

const LABEL: Record<SeniorStatus, string> = { pending: "Waiting", active: "Live", paused: "Paused" };
const STYLE: Record<SeniorStatus, string> = {
  pending: "bg-pp-orange-50 text-pp-orange-700",
  active: "bg-[#0f2e1c] text-[#4ADE80]",
  paused: "bg-pp-soft text-pp-muted",
};

export function StatusPill({ status }: { status: SeniorStatus }) {
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-[12px] font-semibold ${STYLE[status]}`}>{LABEL[status]}</span>;
}

export function SeniorStatusAction({ id, status }: { id: string; status: SeniorStatus }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const next: SeniorStatus = status === "active" ? "paused" : "active";
  const label = status === "pending" ? "Approve" : status === "active" ? "Pause" : "Make live";

  async function go() {
    setBusy(true);
    setErr(null);
    const res = await adminSetStatus(id, next);
    setBusy(false);
    if (res.ok) router.refresh();
    else setErr(res.message);
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button type="button" onClick={go} disabled={busy} className="pp-btn-secondary min-h-[36px] px-3 text-[13px]">
        {busy ? "…" : label}
      </button>
      {err && <span className="text-[12px] text-[#FF7A6E]">{err}</span>}
    </span>
  );
}

/** Copies a senior's personal link so the team can send it to them. */
export function CopyLink({ path }: { path: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="pp-btn-secondary min-h-[36px] px-3 text-[13px]"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(`${window.location.origin}${path}`);
          setDone(true);
          setTimeout(() => setDone(false), 1800);
        } catch {
          window.prompt("Copy this link", `${window.location.origin}${path}`);
        }
      }}
    >
      {done ? "Copied" : "Copy link"}
    </button>
  );
}
