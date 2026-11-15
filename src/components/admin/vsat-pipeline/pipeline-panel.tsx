"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  NEEDS_ASSIGNMENT, PANEL_STAGES, STAGES, STAGE_LABEL, STATUSES, STATUS_LABEL, canManage, errorText, fmtIst, needsReason,
  type PanelKey, type Stage, type Status, type VsatRoles,
} from "@/lib/vsat/pipeline";
import { StudentDrawer } from "./student-drawer";
import type { Batch, ListResult, ListRow } from "./types";

/**
 * One list panel for Applications / VSAT Exam / Interview / Counselling. Data comes only from
 * vsat_pipeline_list (the database applies role, campus and assignment scope). Trickle-down:
 * each panel shows only its own stages as tabs.
 */

const PAGE = 50;
const input = "rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-[#22d3ee] focus:outline-none";
const btn = "rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-40";

export const STATUS_TONE: Record<Status, string> = {
  active: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  not_selected: "border-rose-400/30 bg-rose-400/10 text-rose-300",
  absent: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  on_hold: "border-sky-400/30 bg-sky-400/10 text-sky-300",
};

export function StageBadge({ stage, status }: { stage: Stage; status: Status }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${STATUS_TONE[status]}`}>
      {STAGE_LABEL[stage]}{status !== "active" && <span className="opacity-80">· {STATUS_LABEL[status]}</span>}
    </span>
  );
}

const yesNo = (v: boolean | null | undefined) => (v === true ? "Yes" : v === false ? "No" : "—");
const num = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? "—" : Number(v).toFixed(d).replace(/\.?0+$/, ""));

export function PipelinePanel({ panel, roles }: { panel: PanelKey; roles: VsatRoles }) {
  const [supabase] = useState(() => createClient());
  const stages = PANEL_STAGES[panel];
  const manager = canManage(roles);
  const [tab, setTab] = useState<Stage | null>(panel === "apps" ? null : stages[0]);
  const [status, setStatus] = useState<Status | "">("");
  const [batch, setBatch] = useState("");
  const [campus, setCampus] = useState<"" | "pune" | "gurugram">("");
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<ListResult | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  // search: wait until typing stops; 1 letter is not enough (the database refuses it)
  useEffect(() => {
    const t = setTimeout(() => { setQ(qInput.trim().length >= 2 ? qInput.trim() : ""); setOffset(0); }, 350);
    return () => clearTimeout(t);
  }, [qInput]);

  useEffect(() => {
    void supabase.rpc("vsat_batches").then(({ data: d }) => setBatches(Array.isArray(d) ? (d as Batch[]) : []));
  }, [supabase]);

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    const p: Record<string, unknown> = { limit: PAGE, offset };
    if (tab) p.stage = tab;
    if (status) p.status = status;
    if (batch) p.exam_date_id = batch;
    if (campus) p.campus = campus;
    if (q) p.q = q;
    const { data: d, error } = await supabase.rpc("vsat_pipeline_list", { p });
    if (error) { setErr(errorText(error.message)); setData(null); } else setData(d as ListResult);
    setSel(new Set());
    setLoading(false);
  }, [supabase, tab, status, batch, campus, q, offset]);
  useEffect(() => { void load(); }, [load, reload]);

  const rows = data?.rows ?? [];
  const panelTotal = useMemo(() => stages.reduce((n, s) => n + (data?.counts?.[s] ?? 0), 0), [data, stages]);
  const allOnPage = rows.length > 0 && rows.every((r) => sel.has(r.application_id));

  function toggle(id: string) {
    setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  return (
    <div className="space-y-4 p-5 text-white">
      {/* stage tabs (trickle-down) */}
      <div className="flex flex-wrap gap-2">
        {panel === "apps" && (
          <button className={`${btn} ${tab === null ? "bg-[#34e2b0] text-[#04101a]" : "bg-white/5 text-white/70"}`} onClick={() => { setTab(null); setOffset(0); }}>
            All <span className="opacity-70">{Object.values(data?.counts ?? {}).reduce((a, b) => a + (b ?? 0), 0)}</span>
          </button>
        )}
        {stages.map((s) => (
          <button key={s} className={`${btn} ${tab === s ? "bg-[#34e2b0] text-[#04101a]" : "bg-white/5 text-white/70"}`} onClick={() => { setTab(s); setOffset(0); }}>
            {STAGE_LABEL[s]} <span className="opacity-70">{data?.counts?.[s] ?? 0}</span>
          </button>
        ))}
        {panel !== "apps" && <span className="self-center text-xs text-white/40">{panelTotal} in this panel</span>}
      </div>

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2">
        <input className={`${input} w-64`} placeholder={manager ? "Search name, email, mobile or app no." : "Search name or app no."}
          value={qInput} onChange={(e) => setQInput(e.target.value)} maxLength={100} aria-label="Search" />
        <select className={input} value={status} onChange={(e) => { setStatus(e.target.value as Status | ""); setOffset(0); }} aria-label="Status">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <select className={input} value={batch} onChange={(e) => { setBatch(e.target.value); setOffset(0); }} aria-label="Batch">
          <option value="">All batches</option>
          {batches.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
        </select>
        <select className={input} value={campus} onChange={(e) => { setCampus(e.target.value as "" | "pune" | "gurugram"); setOffset(0); }} aria-label="Campus">
          <option value="">Both campuses</option><option value="pune">Pune</option><option value="gurugram">Gurugram</option>
        </select>
        <button className={`${btn} bg-white/5 text-white/80`} onClick={() => setReload((n) => n + 1)}>Refresh</button>
      </div>

      {manager && sel.size > 0 && (
        <BulkBar ids={[...sel]} current={tab} panel={panel} onDone={() => setReload((n) => n + 1)} />
      )}

      {err && <p className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">{err}</p>}

      <div className="overflow-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/50">
            <tr>
              {manager && <th className="w-8 px-3 py-2"><input type="checkbox" aria-label="Select all on this page" checked={allOnPage}
                onChange={() => setSel(allOnPage ? new Set() : new Set(rows.map((r) => r.application_id)))} /></th>}
              <th className="px-3 py-2">Student</th><th className="px-3 py-2">Campus</th><th className="px-3 py-2">Batch</th><th className="px-3 py-2">Stage</th>
              {(panel === "apps" || panel === "exam") && <><th className="px-3 py-2">Percentile</th><th className="px-3 py-2">VPS</th><th className="px-3 py-2">Eligible</th></>}
              {panel === "intv" && <><th className="px-3 py-2">Interviewer</th><th className="px-3 py-2">Slot (IST)</th><th className="px-3 py-2">Score</th><th className="px-3 py-2">Verdict (calc / interviewer)</th></>}
              {panel === "couns" && <><th className="px-3 py-2">Counsellor</th><th className="px-3 py-2">Slot (IST)</th><th className="px-3 py-2">Category</th><th className="px-3 py-2">Scholarship</th></>}
              <th className="px-3 py-2">Updated</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={10} className="px-3 py-6 text-center text-white/50">Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={10} className="px-3 py-6 text-center text-white/50">No students here.</td></tr>}
            {!loading && rows.map((r) => <Row key={r.application_id} r={r} panel={panel} manager={manager}
              checked={sel.has(r.application_id)} onCheck={() => toggle(r.application_id)} onOpen={() => setOpenId(r.application_id)} />)}
          </tbody>
        </table>
      </div>

      {data && data.total > PAGE && (
        <div className="flex items-center gap-3 text-sm text-white/60">
          <button className={`${btn} bg-white/5`} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</button>
          <span>{offset + 1}–{Math.min(offset + PAGE, data.total)} of {data.total}</span>
          <button className={`${btn} bg-white/5`} disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>Next</button>
        </div>
      )}

      {openId && <StudentDrawer id={openId} roles={roles} onClose={() => setOpenId(null)} onChanged={() => setReload((n) => n + 1)} />}
    </div>
  );
}

function Row({ r, panel, manager, checked, onCheck, onOpen }:
  { r: ListRow; panel: PanelKey; manager: boolean; checked: boolean; onCheck: () => void; onOpen: () => void }) {
  const vps = r.effective?.vps; const el = r.effective?.eligible;
  return (
    <tr className="cursor-pointer border-t border-white/5 hover:bg-white/5" onClick={onOpen}>
      {manager && <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${r.name ?? r.application_id}`} checked={checked} onChange={onCheck} /></td>}
      <td className="px-3 py-2"><div className="font-medium">{r.name ?? "—"}</div><div className="text-xs text-white/40">{r.application_no ?? r.application_id}</div></td>
      <td className="px-3 py-2 capitalize">{r.campus ?? "—"}</td>
      <td className="px-3 py-2">{r.batch ?? "—"}</td>
      <td className="px-3 py-2"><StageBadge stage={r.stage} status={r.status} /></td>
      {(panel === "apps" || panel === "exam") && <>
        <td className="px-3 py-2">{num(r.exam_percentile, 0)}</td>
        <td className="px-3 py-2">{num(vps?.value)}{vps?.override !== null && vps?.override !== undefined && <span title={`Calculated ${num(vps.calculated)}`} className="ml-1 text-xs text-amber-300">override</span>}</td>
        <td className="px-3 py-2">{yesNo(el?.value)}{el?.override !== null && el?.override !== undefined && <span className="ml-1 text-xs text-amber-300">override</span>}</td>
      </>}
      {panel === "intv" && <>
        <td className="px-3 py-2">{r.interview?.interviewer ?? "—"}</td>
        <td className="px-3 py-2">{fmtIst(r.interview?.slot)}</td>
        <td className="px-3 py-2">{num(r.interview?.score)}</td>
        <td className="px-3 py-2">{r.interview?.submitted ? `${r.interview.calc_verdict ?? "—"} / ${r.interview.interviewer_verdict ?? "—"}${r.interview.cheating_seen ? " · cheating" : ""}` : "—"}</td>
      </>}
      {panel === "couns" && <>
        <td className="px-3 py-2">{r.counselling?.counsellor ?? "—"}</td>
        <td className="px-3 py-2">{fmtIst(r.counselling?.slot)}</td>
        <td className="px-3 py-2">{r.counselling?.category ?? "—"}</td>
        <td className="px-3 py-2">{r.counselling?.pct !== null && r.counselling?.pct !== undefined ? `${num(r.counselling.pct)}%` : "—"}</td>
      </>}
      <td className="px-3 py-2 text-xs text-white/50">{fmtIst(r.stage_changed_at)}</td>
    </tr>
  );
}

/** Bulk move (admin / admissions). Each student is checked on its own by the database; skipped ones are listed. */
function BulkBar({ ids, current, panel, onDone }: { ids: string[]; current: Stage | null; panel: PanelKey; onDone: () => void }) {
  const [supabase] = useState(() => createClient());
  const targets = STAGES.filter((s) => !NEEDS_ASSIGNMENT[s]);
  const [to, setTo] = useState<Stage>(current && !NEEDS_ASSIGNMENT[current] ? current : PANEL_STAGES[panel][0]);
  const [st, setSt] = useState<Status>("active");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const reasonNeeded = current ? needsReason(current, "active", to, st) : true;

  async function apply() {
    if (reasonNeeded && reason.trim().length < 3) return setMsg("Please add a reason (at least 3 characters).");
    setBusy(true); setMsg("");
    const p: Record<string, unknown> = { application_ids: ids, to_stage: to, to_status: st };
    if (reason.trim()) p.reason = reason.trim();
    if (current) p.expected_stage = current;
    const { data, error } = await supabase.rpc("vsat_move_bulk", { p });
    setBusy(false);
    if (error) return setMsg(errorText(error.message));
    const d = data as { moved: number; unchanged: number; skipped: { application_id: string; code: string }[] };
    setMsg(`Moved ${d.moved}${d.unchanged ? `, ${d.unchanged} already there` : ""}${d.skipped.length ? `, ${d.skipped.length} skipped: ${d.skipped.slice(0, 5).map((s) => `${s.application_id} (${errorText(s.code)})`).join("; ")}${d.skipped.length > 5 ? " …" : ""}` : ""}.`);
    setReason(""); onDone();
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#34e2b0]/30 bg-[#34e2b0]/5 p-3 text-sm">
      <span className="font-semibold">{ids.length} selected → move to</span>
      <select className={input} value={to} onChange={(e) => setTo(e.target.value as Stage)} aria-label="Move to stage">
        {targets.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
      </select>
      <select className={input} value={st} onChange={(e) => setSt(e.target.value as Status)} aria-label="Status">
        {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
      </select>
      <input className={`${input} w-64`} placeholder={reasonNeeded ? "Reason (required)" : "Reason (optional)"} value={reason}
        onChange={(e) => setReason(e.target.value)} maxLength={500} aria-label="Reason" />
      <button className={`${btn} bg-[#34e2b0] text-[#04101a]`} disabled={busy} onClick={apply}>{busy ? "Moving…" : "Move"}</button>
      <span className="text-xs text-white/50">Scheduling an interview or counselling is done from the student page (it needs a person and a slot).</span>
      {msg && <p className="w-full text-white/80">{msg}</p>}
    </div>
  );
}
