"use client";
import { useMemo, useState } from "react";
import { linkedInShareUrl } from "@/lib/events";
import { CertificateModal } from "@/components/events/certificate-modal";

export type CertRow = { id: string; kind: "participation" | "winner" | "completion"; source: string; event_id: string | null; module_id: string | null; issued_on: string; events: { name: string | null } | null; cs_modules: { title: string | null } | null };
const fdate = (s: string) => new Date(s).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });

/** Certificates as collapsible folders: Events -> per-event subfolders (participation/winner),
 *  plus a flat CodeSprint folder. Each certificate opens in the CertificateModal. Shared by dashboard + profile. */
export function CertificatesFolders({ certs }: { certs: CertRow[] }) {
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const [openCert, setOpenCert] = useState<string | null>(null);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const toggleFolder = (k: string) => setOpenFolders((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const eventGroups = useMemo(() => {
    const m = new Map<string, { key: string; name: string; certs: CertRow[] }>();
    certs.filter((c) => c.source !== "codesprint").forEach((c) => { const key = c.event_id || c.events?.name || c.id; if (!m.has(key)) m.set(key, { key, name: c.events?.name || "Vedam event", certs: [] }); m.get(key)!.certs.push(c); });
    return Array.from(m.values());
  }, [certs]);
  const csCerts = useMemo(() => certs.filter((c) => c.source === "codesprint"), [certs]);
  if (eventGroups.length === 0 && csCerts.length === 0) return <p className="font-body text-sm text-white/50">No certificates yet — take part in an event or finish a CodeSprint module and they&apos;ll show up here.</p>;
  return (
    <div className="space-y-2">
      {eventGroups.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
          <button onClick={() => toggleFolder("events")} className="flex w-full items-center gap-3 p-4 text-left">
            <span className="text-xl">{openFolders.has("events") ? "\uD83D\uDCC2" : "\uD83D\uDCC1"}</span>
            <div className="min-w-0 flex-1"><p className="font-display text-sm font-semibold text-white">Bootcamps &amp; Events</p>
              <p className="font-mono text-[11px] text-white/50">{eventGroups.length} event{eventGroups.length > 1 ? "s" : ""}</p></div>
            <span className="font-mono text-xs text-white/50">{openFolders.has("events") ? "\u25B2" : "\u25BC"}</span>
          </button>
          {openFolders.has("events") && (
            <div className="space-y-2 border-t border-white/10 p-3">
              {eventGroups.map((g) => {
                const k = "events:" + g.key; const open = openFolders.has(k);
                return (
                  <div key={g.key} className="overflow-hidden rounded-xl border border-white/10 bg-white/[0.05]">
                    <button onClick={() => toggleFolder(k)} className="flex w-full items-center gap-3 p-3 text-left">
                      <span>{open ? "\uD83D\uDCC2" : "\uD83D\uDCC1"}</span>
                      <div className="min-w-0 flex-1"><p className="truncate font-display text-sm font-semibold text-white">{g.name}</p>
                        <p className="font-mono text-[11px] text-white/50">{g.certs.length} certificate{g.certs.length > 1 ? "s" : ""} · {g.certs.map((c) => c.kind === "winner" ? "Winner" : "Participation").join(" + ")}</p></div>
                      <span className="font-mono text-xs text-white/50">{open ? "\u25B2" : "\u25BC"}</span>
                    </button>
                    {open && <div className="grid gap-3 border-t border-white/10 p-3 sm:grid-cols-2">{g.certs.map((c) => <CertCard key={c.id} cert={c} origin={origin} onView={setOpenCert} />)}</div>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      {csCerts.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
          <button onClick={() => toggleFolder("codesprint")} className="flex w-full items-center gap-3 p-4 text-left">
            <span className="text-xl">{openFolders.has("codesprint") ? "\uD83D\uDCC2" : "\uD83D\uDCC1"}</span>
            <div className="min-w-0 flex-1"><p className="font-display text-sm font-semibold text-white">CodeSprint</p>
              <p className="font-mono text-[11px] text-white/50">{csCerts.length} certificate{csCerts.length > 1 ? "s" : ""}</p></div>
            <span className="font-mono text-xs text-white/50">{openFolders.has("codesprint") ? "\u25B2" : "\u25BC"}</span>
          </button>
          {openFolders.has("codesprint") && <div className="grid gap-3 border-t border-white/10 p-3 sm:grid-cols-2">{csCerts.map((c) => <CertCard key={c.id} cert={c} origin={origin} onView={setOpenCert} />)}</div>}
        </div>
      )}
      {openCert && <CertificateModal certId={openCert} onClose={() => setOpenCert(null)} />}
    </div>
  );
}

function CertCard({ cert: c, origin, onView }: { cert: CertRow; origin: string; onView: (id: string) => void }) {
  const winner = c.kind === "winner";
  const completion = c.source === "codesprint";
  const label = completion ? (c.cs_modules?.title || "CodeSprint") : winner ? "Winner" : "Participation";
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.05] p-4">
      <div className="flex items-start justify-between gap-2">
        <span className={["rounded-full px-2.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide", winner ? "bg-[linear-gradient(120deg,#B8860B,#F5C542)] text-[#3a2a00]" : "bg-white/[0.05] text-accent"].join(" ")}>{completion ? "Completion" : winner ? "\uD83C\uDFC6 Winner" : "Participation"}</span>
        <span className="font-mono text-[10px] text-white/50">{fdate(c.issued_on)}</span>
      </div>
      {completion && <p className="truncate font-display text-xs font-semibold text-white">{label}</p>}
      <div className="mt-auto flex gap-2">
        <button onClick={() => onView(c.id)} className="flex-1 rounded-lg border border-white/10 px-3 py-2 text-center text-xs font-semibold text-white/85 hover:bg-white/[0.05]">View</button>
        <a href={linkedInShareUrl(`${origin}/certificate?c=${c.id}`)} target="_blank" rel="noreferrer" className="flex-1 rounded-lg bg-[#0A66C2] px-3 py-2 text-center text-xs font-semibold text-white">Share</a>
      </div>
    </div>
  );
}
