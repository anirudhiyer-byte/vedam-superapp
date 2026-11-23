"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cx, vx } from "@/components/admin/ui/vx";
import { PageHead } from "@/components/admin/ui/page-head";
import { FacetPick, type Opt } from "@/components/admin/vsat-pipeline/facet-pick";
import { DeletePerson } from "@/components/admin/vsat-delete-person";
import { CommsBroadcast } from "@/components/admin/comms-broadcast";

/**
 * VSAT Leads — EVERYONE who filled the first half of the form (a lead_manager row),
 * whether or not they went on to apply/pay. Data comes only from vsat_leads_list
 * (the database re-checks role + campus scope on every call). Facet dropdowns (campus,
 * lead stage, applied, source) carry live counts that respect the other dropdowns (0120).
 */

const PAGE = 50;
const input = vx.field;

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
  if (!value) return <span className="text-vx-faint">—</span>;
  return <span className={`font-mono text-[11px] ${muted ? "text-vx-faint" : "text-vx-ink"}`} title={value}>{value}</span>;
}

/** Leads → CSV text (every value quoted). Mirrors the columns shown in the table. */
const CSV_COLS: { key: string; label: string }[] = [
  { key: "name", label: "Name" }, { key: "email", label: "Email" }, { key: "mobile", label: "Mobile" },
  { key: "campus", label: "Campus" }, { key: "lead_stage", label: "Stage" }, { key: "lead_source", label: "Source" },
  { key: "application_submitted", label: "Applied" },
  { key: "primary_utm", label: "Primary campaign" }, { key: "latest_utm", label: "Latest campaign" }, { key: "created_at", label: "Joined" },
];
function leadsCsv(rows: Row[]): string {
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const val = (key: string, r: Row) => {
    const v = (r as Record<string, unknown>)[key];
    if (key === "campus") return campusLabel(v as string | null);
    if (key === "lead_stage") return stageLabel(v as string | null);
    if (key === "application_submitted") return v ? "Yes" : "No";
    if (key === "created_at") { const f = fmt(v as string | null); return f === "—" ? "" : f; }
    return v == null ? "" : String(v);
  };
  const head = CSV_COLS.map((c) => c.label);
  const body = rows.map((r) => CSV_COLS.map((c) => val(c.key, r)));
  return [head, ...body].map((line) => line.map(esc).join(",")).join("\n");
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
  const [isAdmin, setIsAdmin] = useState(false);
  const [busy, setBusy] = useState<"" | "csv" | "comms">("");
  const [notice, setNotice] = useState("");
  const [comm, setComm] = useState<null | "email" | "whatsapp">(null);
  const [recipients, setRecipients] = useState<{ user_id: string; email: string | null; phone: string | null; full_name: string | null; state: string | null; city: string | null }[]>([]);

  useEffect(() => {
    let on = true;
    void supabase.rpc("is_admin").then(({ data: a }) => { if (on) setIsAdmin(a === true); });
    return () => { on = false; };
  }, [supabase]);

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

  // Export / Communicate act on the WHOLE filtered set (not just the page) — the database
  // re-checks role + campus and caps at 5000. Mirrors the VSAT Applications grid.
  function filterParams() {
    const p: Record<string, unknown> = {};
    if (campuses.length) p.campuses = campuses;
    if (leadStages.length) p.lead_stages = leadStages;
    if (applied.length === 1) p.applied = applied[0];
    if (sources.length) p.sources = sources;
    if (q) p.q = q;
    return p;
  }
  async function pull(): Promise<{ total: number; rows: Row[] } | null> {
    const { data: d, error } = await supabase.rpc("vsat_leads_export", { p: filterParams() });
    if (error) {
      setNotice(/TOO_MANY_ROWS/.test(error.message) ? "Too many leads match (over 5,000) — narrow the filters first." : "Couldn’t load the leads. Try again.");
      return null;
    }
    return d as { total: number; rows: Row[] };
  }
  async function exportCsv() {
    setBusy("csv"); setNotice("");
    const d = await pull(); setBusy("");
    if (!d) return;
    const blob = new Blob([leadsCsv(d.rows)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `vsat-leads-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
    setNotice(`Exported ${d.total} lead${d.total === 1 ? "" : "s"}.`);
  }
  async function openComms() {
    setBusy("comms"); setNotice("");
    const d = await pull(); setBusy("");
    if (!d) return;
    if (d.total === 0) { setNotice("No leads match these filters to message."); return; }
    setRecipients(d.rows.map((r) => ({ user_id: r.lead_id, email: r.email, phone: r.mobile, full_name: r.name, state: null, city: null })));
    setComm("email");
  }

  return (
    <div className="space-y-4 p-4 font-sans text-vx-ink sm:p-8">
      <PageHead title="VSAT Leads" count={`${total.toLocaleString("en-IN")} lead${total === 1 ? "" : "s"}${anyFilter ? " match" : ""}`} />
      <div className="flex flex-wrap items-center gap-2">
        <input className={cx(input, "w-full sm:w-72")} placeholder="Search name, email or mobile" value={qInput} onChange={(e) => setQInput(e.target.value)} maxLength={100} aria-label="Search" />
        <FacetPick title="Campus" options={campusOpts} value={campuses} onChange={(v) => { setCampuses(v); setOffset(0); }} />
        <FacetPick title="Stage" options={stageOpts} value={leadStages} onChange={(v) => { setLeadStages(v); setOffset(0); }} />
        <FacetPick title="Applied" options={appliedOpts} value={applied} onChange={(v) => { setApplied(v); setOffset(0); }} />
        {sourceOpts.length > 1 && <FacetPick title="Source" options={sourceOpts} value={sources} onChange={(v) => { setSources(v); setOffset(0); }} />}
        {anyFilter && <button className="text-xs text-vx-mut underline-offset-2 hover:text-vx-ink hover:underline" onClick={clearFilters}>Clear filters</button>}
        <span className="flex-1" />
        <button className={cx(vx.btn, vx.ghost, vx.sm)} onClick={() => void exportCsv()} disabled={busy !== "" || loading || total === 0}>
          {busy === "csv" ? "Exporting…" : "Export CSV"}
        </button>
        <button className={cx(vx.btn, vx.secondary, vx.sm)} onClick={() => void openComms()} disabled={busy !== "" || loading || total === 0}>
          {busy === "comms" ? "Loading…" : "Communicate"}
        </button>
      </div>
      {notice && <div className="text-xs text-vx-mut">{notice}</div>}

      {err && <div role="alert" className={vx.error}>{err}</div>}

      <div className="overflow-auto rounded-[18px] border border-vx-line bg-white/[0.015] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="bg-white/[0.02] text-[12.5px] text-vx-faint">
            <tr>
              <th className="border-b border-vx-line px-3 py-3 font-medium">Lead</th>
              <th className="border-b border-vx-line px-3 py-3 font-medium">Contact</th>
              <th className="border-b border-vx-line px-3 py-3 font-medium">Campus</th>
              <th className="border-b border-vx-line px-3 py-3 font-medium">Stage</th>
              <th className="border-b border-vx-line px-3 py-3 font-medium">Primary campaign</th>
              <th className="border-b border-vx-line px-3 py-3 font-medium">Latest campaign</th>
              <th className="border-b border-vx-line px-3 py-3 font-medium">Applied</th>
              <th className="border-b border-vx-line px-3 py-3 font-medium">Joined</th>
              {isAdmin && <th className="border-b border-vx-line px-3 py-3 font-medium text-right">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-vx-line-soft">
            {loading && <tr><td colSpan={isAdmin ? 9 : 8} className="px-4 py-10 text-center text-vx-faint">Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={isAdmin ? 9 : 8} className="px-4 py-10 text-center text-vx-faint">{anyFilter ? "No leads match these filters." : "No leads yet."}</td></tr>}
            {!loading && rows.map((r) => (
              <tr key={r.lead_id} className="transition-colors hover:bg-white/[0.03]">
                <td className="min-w-[150px] px-4 py-3 font-medium text-vx-ink">{r.name || "—"}</td>
                <td className="px-3 py-3">
                  <div className="text-vx-mut">{r.email || "—"}</div>
                  <div className="text-[12px] text-vx-faint">{r.mobile || "—"}</div>
                </td>
                <td className="px-3 py-3 text-vx-mut">{campusLabel(r.campus)}</td>
                <td className="px-3 py-3 text-vx-mut">{stageLabel(r.lead_stage)}</td>
                <td className="px-3 py-3"><Utm value={r.primary_utm} /></td>
                <td className="px-3 py-3"><Utm value={r.latest_utm} muted /></td>
                <td className="px-3 py-3">
                  <span className={cx(vx.badge, r.application_submitted ? vx.tone.green : vx.tone.neutral)}>
                    {r.application_submitted ? "Yes" : "No"}
                  </span>
                </td>
                <td className="px-3 py-3 whitespace-nowrap text-vx-mut">{fmt(r.created_at)}</td>
                {isAdmin && (
                  <td className="px-3 py-3 text-right">
                    <DeletePerson kind="lead" id={r.lead_id} name={r.name} email={r.email} onDeleted={() => void load()} compact />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-vx-faint">{rows.length ? `${offset + 1}–${offset + rows.length} of ${total}` : "—"}</span>
        <div className="flex gap-2">
          <button className={cx(vx.btn, vx.ghost, vx.sm)} disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Prev</button>
          <button className={cx(vx.btn, vx.secondary, vx.sm)} disabled={offset + rows.length >= total || loading} onClick={() => setOffset(offset + PAGE)}>Next</button>
        </div>
      </div>

      {comm && (
        <>
          <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm" onClick={() => setComm(null)} />
          <div className="fixed left-1/2 top-6 z-50 w-[min(780px,94%)] -translate-x-1/2 overflow-hidden rounded-2xl border border-vx-line bg-[#0e0b29] text-vx-ink shadow-2xl">
            <div className="flex items-center justify-between border-b border-vx-line px-5 py-4">
              <h2 className="flex items-center gap-2.5 text-base font-bold">Send Communication
                <span className="rounded-full bg-vx-violet/15 px-2.5 py-0.5 text-xs font-semibold text-vx-violet-t">{recipients.length} recipient{recipients.length === 1 ? "" : "s"}</span></h2>
              <button onClick={() => setComm(null)} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-lg border border-vx-line text-lg leading-none text-vx-mut hover:text-vx-ink">×</button>
            </div>
            <div className="flex gap-1 px-5 pt-3">
              {(["email", "whatsapp"] as const).map((ch) => (
                <button key={ch} onClick={() => setComm(ch)} className={["inline-flex items-center gap-2 rounded-t-xl border border-b-0 px-4 py-2 text-sm font-semibold", comm === ch ? "border-vx-line bg-white/[0.04] text-vx-ink" : "border-transparent text-vx-faint hover:text-vx-ink"].join(" ")}>
                  {ch === "email" ? "Email" : "WhatsApp"}
                </button>
              ))}
            </div>
            <div className="max-h-[74vh] overflow-y-auto border-t border-vx-line px-1 py-1">
              <CommsBroadcast channel={comm} product="all" overrideRecipients={recipients} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
