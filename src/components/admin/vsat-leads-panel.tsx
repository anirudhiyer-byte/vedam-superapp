"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { FacetPick, type Opt } from "@/components/admin/vsat-pipeline/facet-pick";

/**
 * VSAT Leads — EVERYONE who filled the first half of the form (a lead_manager row),
 * whether or not they went on to apply/pay. Data comes only from vsat_leads_list
 * (the database re-checks role + campus scope on every call). Facet dropdowns (campus,
 * lead stage, applied, source) carry live counts that respect the other dropdowns (0120).
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
type Facets = {
  campus: Record<string, number>; lead_stage: Record<string, number>;
  applied: { yes: number; no: number }; source: Record<string, number>;
};
type Result = { total: number; facets: Facets | null; rows: Row[]; limit: number; offset: number };

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }) : "—");
const campusLabel = (c: string | null) => (c === "pune" ? "Pune" : c === "gurugram" ? "Gurugram" : "—");
const stageLabel = (s: string | null) => (s ? s.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()) : "—");
const sourceLabel = (s: string) => (s === "none" ? "Unknown" : s);

function Utm({ value, muted }: { value: string | null; muted?: boolean }) {
  if (!value) return <span className="text-white/30">—</span>;
  return <span className={`font-mono text-[11px] ${muted ? "text-white/45" : "text-white/80"}`} title={value}>{value}</span>;
}

export function VsatLeadsPanel() {
  const [supabase] = useState(() => createClient());
  const [campuses, setCampuses] = useState<string[]>([]);
  const [leadStages, setLeadStages] = useState<string[]>([]);
  const [applied, setApplied] = useState<string[]>([]); // ['yes'] | ['no'] | [] (both/none → no filter)
  const [sources, setSources] = useState<string[]>([]);
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
    if (campuses.length) p.campuses = campuses;
    if (leadStages.length) p.lead_stages = leadStages;
    if (applied.length === 1) p.applied = applied[0]; // scalar; both/none means "don't filter"
    if (sources.length) p.sources = sources;
    if (q) p.q = q;
    const { data: d, error } = await supabase.rpc("vsat_leads_list", { p });
    if (error) { setErr(error.message); setData(null); } else setData(d as Result);
    setLoading(false);
  }, [supabase, campuses, leadStages, applied, sources, q, offset]);
  useEffect(() => { void load(); }, [load]);

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const facets = data?.facets ?? null;
  const anyFilter = campuses.length > 0 || leadStages.length > 0 || applied.length > 0 || sources.length > 0 || !!q;

  const campusOpts: Opt[] = [
    { value: "pune", label: "Pune", count: facets ? facets.campus.pune ?? 0 : null },
    { value: "gurugram", label: "Gurugram", count: facets ? facets.campus.gurugram ?? 0 : null },
  ];
  // lead stage + source dropdowns are data-driven from the facets (only values present appear)
  const stageOpts: Opt[] = useMemo(() => {
    const keys = new Set<string>([...leadStages, ...(facets ? Object.keys(facets.lead_stage) : [])]);
    return [...keys].filter((k) => k !== "none").sort()
      .map((k) => ({ value: k, label: stageLabel(k), count: facets ? facets.lead_stage[k] ?? 0 : null }));
  }, [facets, leadStages]);
  const appliedOpts: Opt[] = [
    { value: "yes", label: "Applied", count: facets ? facets.applied.yes ?? 0 : null },
    { value: "no", label: "Not applied", count: facets ? facets.applied.no ?? 0 : null },
  ];
  const sourceOpts: Opt[] = useMemo(() => {
    const keys = new Set<string>([...sources, ...(facets ? Object.keys(facets.source) : [])]);
    return [...keys].sort().map((k) => ({ value: k, label: sourceLabel(k), count: facets ? facets.source[k] ?? 0 : null }));
  }, [facets, sources]);

  function clearFilters() { setCampuses([]); setLeadStages([]); setApplied([]); setSources([]); setQInput(""); setOffset(0); }

  return (
    <div className="space-y-4 p-5 text-white">
      <div className="flex flex-wrap items-center gap-2">
        <input className={`${input} w-72`} placeholder="Search name, email or mobile" value={qInput} onChange={(e) => setQInput(e.target.value)} maxLength={100} aria-label="Search" />
        <FacetPick title="Campus" options={campusOpts} value={campuses} onChange={(v) => { setCampuses(v); setOffset(0); }} />
        <FacetPick title="Stage" options={stageOpts} value={leadStages} onChange={(v) => { setLeadStages(v); setOffset(0); }} />
        <FacetPick title="Applied" options={appliedOpts} value={applied} onChange={(v) => { setApplied(v); setOffset(0); }} />
        {sourceOpts.length > 1 && <FacetPick title="Source" options={sourceOpts} value={sources} onChange={(v) => { setSources(v); setOffset(0); }} />}
        <span className="ml-auto text-xs text-white/50">{total} lead{total === 1 ? "" : "s"}{anyFilter ? " match" : ""}</span>
        {anyFilter && <button className="text-xs text-white/60 underline-offset-2 hover:text-white hover:underline" onClick={clearFilters}>Clear filters</button>}
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
            {!loading && rows.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-white/40">{anyFilter ? "No leads match these filters." : "No leads yet."}</td></tr>}
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
