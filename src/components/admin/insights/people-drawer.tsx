"use client";

import { useEffect, useMemo, useState } from "react";
import { rpcAll } from "@/lib/supabase/rpc-all";
import { LEVEL_LABEL, fmt, personStatus, productLabel, shortDate, sourceLabel, type Person } from "./lib";
import { sb, type PeopleFilter } from "./data";
import { ErrorNote, Loading, Pill } from "./ui";

const PAGE = 100;

/** Side panel listing the people behind a number, with each person's progress in every product. */
export function PeopleDrawer({ filter, onClose }: { filter: PeopleFilter; onClose: () => void }) {
  const [rows, setRows] = useState<Person[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => {
    let live = true;
    (async () => {
      setRows(null); setError(null); setLimit(PAGE);
      const { title: _t, sub: _s, ...args } = filter;
      void _t; void _s;
      const { data, error: err } = await rpcAll<Person>(sb(), "ins_people", args);
      if (!live) return;
      if (err) setError(err); else setRows(data);
    })();
    return () => { live = false; };
  }, [filter]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!rows) return [];
    if (!t) return rows;
    return rows.filter((p) => [p.name, p.email, p.phone, p.public_id].some((v) => (v ?? "").toLowerCase().includes(t)));
  }, [rows, q]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={filter.title}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div className="relative flex h-full w-full max-w-2xl flex-col border-l border-white/10 bg-[#0b0b12] shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-white/10 p-4 sm:p-5">
          <div>
            <h2 className="text-lg font-bold text-white">{filter.title}</h2>
            <p className="text-[13px] text-white/50">{filter.sub ?? ""}{rows ? ` · ${fmt(rows.length)} people` : ""}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-white/15 px-3 py-1.5 text-[13px] text-white/80 hover:bg-white/[0.06]">Close</button>
        </div>
        <div className="border-b border-white/10 p-3 sm:px-5">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email, phone or Vedam ID"
            className="w-full rounded-xl border border-white/15 bg-white/[0.05] px-3 py-2 text-[14px] text-white outline-none placeholder:text-white/35 focus:border-[#8A18FF]" />
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto p-3 sm:px-5">
          {error ? <ErrorNote message={error} /> : !rows ? <><Loading h={90} /><Loading h={90} /><Loading h={90} /></> :
            shown.length === 0 ? <p className="py-8 text-center text-[13px] text-white/45">No one matches.</p> : (
              <>
                {shown.slice(0, limit).map((p) => <PersonCard key={p.user_id} p={p} />)}
                {shown.length > limit && (
                  <button type="button" onClick={() => setLimit((l) => l + PAGE)} className="w-full rounded-xl border border-white/15 py-2 text-[13px] text-white/80 hover:bg-white/[0.06]">
                    Show {Math.min(PAGE, shown.length - limit)} more ({fmt(shown.length - limit)} left)
                  </button>
                )}
              </>
            )}
        </div>
      </div>
    </div>
  );
}

function PersonCard({ p }: { p: Person }) {
  const status = personStatus(p);
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <span className="font-semibold text-white">{p.name || "No name yet"}</span>
          {p.public_id && <span className="ml-2 font-mono text-[11.5px] text-white/40">{p.public_id}</span>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {p.mqr && <Pill tone="accent">MQR</Pill>}
          {p.vsat_at ? <Pill tone="good">VSAT early · {shortDate(p.vsat_at)}</Pill> : <Pill tone="muted">No VSAT yet</Pill>}
          <Pill>{LEVEL_LABEL[p.level]?.name ?? p.level}</Pill>
        </div>
      </div>
      <div className="mt-1 text-[12.5px] text-white/55">
        {[p.email, p.phone].filter(Boolean).join(" · ") || "No contact details"}
      </div>
      <div className="mt-0.5 text-[12px] text-white/40">
        Signed up {shortDate(p.signup_at)} · {sourceLabel(p.source)} · {p.state} · {p.full ? "full profile" : "partial profile"}
      </div>
      {status.length > 0 ? (
        <div className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
          {status.map((s) => (
            <div key={s.product} className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-2.5 py-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-white/45">{productLabel(s.product)}</div>
              <div className="text-[12.5px] text-white/85">{s.text}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-2 text-[12px] text-white/40">Has not used a product yet.</div>
      )}
    </div>
  );
}
