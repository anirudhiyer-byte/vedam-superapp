"use client";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * VSAT Leads — EVERYONE who filled the first half of the form (a lead_manager row),
 * whether or not they went on to apply/pay. Data comes only from vsat_leads_list
 * (the database re-checks role + campus scope on every call).
 */

const PAGE = 50;
const input = "rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-[#22d3ee] focus:outline-none";
const btn = "rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-40";

type Row = {
  lead_id: string; name: string | null; email: string | null; mobile: string | null;
  campus: "pune" | "gurugram" | null; lead_stage: string | null; lead_source: string | null; source_hearabout: string | null;
  application_submitted: boolean | null; primary_utm: string | null; secondary_utm: string | null; tertiary_utm: string | null;
  latest_utm: string | null; primary_utm_source: string | null; primary_utm_medium: string | null; primary_utm_campaign: string | null;
  created_at: string | null;
};
type Result = { total: number; rows: Row[]; limit: number; offset: number };

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }) : "—");
const campusLabel = (c: string | null) => (c === "pune" ? "Pune" : c === "gurugram" ? "Gurugram" : "—");
const stageLabel = (s: string | null) => (s ? s.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()) : "—");

function Utm({ value, muted }: { value: string | null; muted?: boolean }) {
  if (!value) return <span className="text-white/30">—</span>;
  return <span className={`font-mono text-[11px] ${muted ? "text-white/45" : "text-white/80"}`} title={value}>{value}</span>;
}

export function VsatLeadsPanel() {
  const [supabase] = useState(() => createClient());
  const [campus, setCampus] = useState<"" | "pune" | "gurugram">("");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    const t = setTimeout(() => { setQ(qInput.trim().length >= 2 ? qInput.trim() : ""); setOffset(0); }, 350);
    return () => clearTimeout(t);
  }, [qInput]);

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    const p: Record<string, unknown> = { limit: PAGE, offset };
    if (campus) p.campus = campus;
    if (q) p.q = q;
    const { data: d, error } = await supabase.rpc("vsat_leads_list", { p });
    if (error) { setErr(error.message); setData(null); } else setData(d as Result);
    setLoading(false);
  }, [supabase, campus, q, offset]);
  useEffect(() => { void load(); }, [load]);

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="space-y-4 p-5 text-white">
      <div className="flex flex-wrap items-center gap-2">
        <input className={`${input} w-72`} placeholder="Search name, email or mobile" value={qInput} onChange={(e) => setQInput(e.target.value)} maxLength={100} aria-label="Search" />
        <select className={input} value={campus} onChange={(e) => { setCampus(e.target.value as "" | "pune" | "gurugram"); setOffset(0); }} aria-label="Campus">
          <option value="">All campuses</option>
          <option value="pune">Pune</option>
          <option value="gurugram">Gurugram</option>
        </select>
        <span className="ml-auto text-xs text-white/50">{total} lead{total === 1 ? "" : "s"}</span>
      </div>

      {err && <div className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">{err}</div>}

      <div className="overflow-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="bg-white/5 text-[11px] uppercase tracking-wider text-white/45">
            <tr>
              <th className="px-3 py-2.5 font-semibold">Lead</th>
              <th className="px-3 py-2.5 font-semibold">Contact</th>
              <th className="px-3 py-2.5 font-semibold">Campus</th>
              <th className="px-3 py-2.5 font-semibold">Stage</th>
              <th className="px-3 py-2.5 font-semibold">Primary campaign</th>
              <th className="px-3 py-2.5 font-semibold">Latest campaign</th>
              <th className="px-3 py-2.5 font-semibold">Applied</th>
              <th className="px-3 py-2.5 font-semibold">Joined</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {loading && <tr><td colSpan={8} className="px-3 py-8 text-center text-white/40">Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-white/40">No leads match.</td></tr>}
            {!loading && rows.map((r) => (
              <tr key={r.lead_id} className="hover:bg-white/[.03]">
                <td className="px-3 py-2.5 font-medium text-white/90">{r.name || "—"}</td>
                <td className="px-3 py-2.5">
                  <div className="text-white/70">{r.email || "—"}</div>
                  <div className="text-[12px] text-white/45">{r.mobile || "—"}</div>
                </td>
                <td className="px-3 py-2.5 text-white/70">{campusLabel(r.campus)}</td>
                <td className="px-3 py-2.5 text-white/70">{stageLabel(r.lead_stage)}</td>
                <td className="px-3 py-2.5"><Utm value={r.primary_utm} /></td>
                <td className="px-3 py-2.5"><Utm value={r.latest_utm} muted /></td>
                <td className="px-3 py-2.5">
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${r.application_submitted ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : "border-white/10 bg-white/5 text-white/35"}`}>
                    {r.application_submitted ? "Yes" : "No"}
                  </span>
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap text-white/60">{fmt(r.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-white/40">{rows.length ? `${offset + 1}–${offset + rows.length} of ${total}` : "—"}</span>
        <div className="flex gap-2">
          <button className={`${btn} bg-white/5 text-white/70`} disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Prev</button>
          <button className={`${btn} bg-white/5 text-white/70`} disabled={offset + rows.length >= total || loading} onClick={() => setOffset(offset + PAGE)}>Next</button>
        </div>
      </div>
    </div>
  );
}
