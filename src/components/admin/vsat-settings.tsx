"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { errorText } from "@/lib/vsat/pipeline";
import {
  WEIGHT_KEYS, WEIGHT_LABEL, anchorErrors, anchorsText, awardSteps, bandErrors, bandsToDraft, draftToBands, inr, toFraction, toPct, weightErrors,
  type Anchor, type BandDraft, type CampusKey, type CampusSetting, type SettingsData, type VsatRow, type WeightKey,
} from "@/lib/vsat/settings";

/**
 * VSAT Settings · Scholarship & scoring (admin only, migration 0098).
 * Campus fee / days to pay / JEE floor · interview weights · scholarship bands (default or per VSAT)
 * · each VSAT's VPS curve and "cleared" cut-off. Every save is checked and logged by the database.
 */

const input = "rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-[#22d3ee] focus:outline-none";
const num = `${input} w-24 tabular-nums`;
const btn = "rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-40";
const primary = `${btn} bg-[#34e2b0] text-[#04101a]`;
const ghost = `${btn} border border-white/10 bg-white/5 text-white/80 hover:bg-white/10`;
const card = "rounded-xl border border-white/10 bg-white/[0.03] p-4";
const CAMPUS_LABEL: Record<CampusKey, string> = { pune: "Pune", gurugram: "Gurugram" };
const n = (v: string) => (v.trim() === "" ? NaN : Number(v));

function Msg({ m }: { m: { ok: boolean; text: string } | null }) {
  if (!m) return null;
  return <p className={`text-sm ${m.ok ? "text-emerald-300" : "text-rose-300"}`}>{m.text}</p>;
}

export function VsatSettings() {
  const [supabase] = useState(() => createClient());
  const [data, setData] = useState<SettingsData | null>(null);
  const [err, setErr] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let on = true;
    void supabase.rpc("vsat_settings_get").then(({ data: d, error }) => {
      if (!on) return;
      if (error) { setErr(error.message === "FORBIDDEN" ? "Only admins can open the VSAT settings." : errorText(error.message)); return; }
      setErr(""); setData(d as SettingsData);
    });
    return () => { on = false; };
  }, [supabase, reload]);
  const refresh = useCallback(() => setReload((x) => x + 1), []);

  if (err) return <div className="p-5"><p className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">{err}</p></div>;
  if (!data) return <div className="p-5 text-sm text-white/50">Loading…</div>;

  return (
    <div className="space-y-6 p-5 text-white">
      <p className="text-sm text-white/55">Changes apply to calculations from now on. Interviews and counselling already submitted keep their saved values. Every change is logged.</p>
      <CampusSection campuses={data.campuses} onSaved={refresh} />
      <WeightsSection data={data} onSaved={refresh} />
      <BandsSection data={data} onSaved={refresh} />
      <VsatSection data={data} onSaved={refresh} />
    </div>
  );
}

/* ── campus ─────────────────────────────────────────────────────────────── */
function CampusSection({ campuses, onSaved }: { campuses: CampusSetting[]; onSaved: () => void }) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold">Fees, days to pay and JEE floor</h2>
      <div className="grid gap-3 md:grid-cols-2">{campuses.map((c) => <CampusCard key={c.campus} c={c} onSaved={onSaved} />)}</div>
    </section>
  );
}

function CampusCard({ c, onSaved }: { c: CampusSetting; onSaved: () => void }) {
  const [supabase] = useState(() => createClient());
  const [fee, setFee] = useState(String(c.programme_fee));
  const [days, setDays] = useState(String(c.offer_days));
  const [jee, setJee] = useState(c.jee_floor_enabled);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = Number(fee) !== Number(c.programme_fee) || Number(days) !== c.offer_days || jee !== c.jee_floor_enabled;

  async function save() {
    const f = n(fee), d = n(days);
    if (!(f >= 100000 && f <= 10000000)) return setMsg({ ok: false, text: "Programme fee: ₹1,00,000 to ₹1,00,00,000." });
    if (!(Number.isInteger(d) && d >= 1 && d <= 60)) return setMsg({ ok: false, text: "Days to pay: a whole number from 1 to 60." });
    setBusy(true); setMsg(null);
    const { error } = await supabase.rpc("vsat_settings_campus_set", { p: { campus: c.campus, programme_fee: f, offer_days: d, jee_floor_enabled: jee } });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: errorText(error.message) });
    setMsg({ ok: true, text: "Saved." }); onSaved();
  }

  return (
    <div className={`${card} space-y-3`}>
      <h3 className="font-semibold">{CAMPUS_LABEL[c.campus]}</h3>
      <label className="flex items-center justify-between gap-3 text-sm"><span className="text-white/70">Programme fee (₹)</span>
        <input className={`${input} w-40 tabular-nums`} inputMode="numeric" value={fee} onChange={(e) => setFee(e.target.value.replace(/[^\d]/g, ""))} aria-label={`${CAMPUS_LABEL[c.campus]} programme fee`} /></label>
      <p className="-mt-2 text-right text-xs text-white/40">{Number.isFinite(n(fee)) ? inr(n(fee)) : ""}</p>
      <label className="flex items-center justify-between gap-3 text-sm"><span className="text-white/70">Days to pay after the offer</span>
        <input className={num} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/[^\d]/g, ""))} aria-label={`${CAMPUS_LABEL[c.campus]} days to pay`} /></label>
      <label className="flex items-center justify-between gap-3 text-sm"><span className="text-white/70">JEE floor (90+ → at least 30% … 98.5+ → 70%)</span>
        <input type="checkbox" className="h-4 w-4 accent-[#34e2b0]" checked={jee} onChange={(e) => setJee(e.target.checked)} aria-label={`${CAMPUS_LABEL[c.campus]} JEE floor`} /></label>
      <div className="flex items-center gap-3"><button className={primary} disabled={!dirty || busy} onClick={save}>{busy ? "Saving…" : "Save"}</button><Msg m={msg} /></div>
    </div>
  );
}

/* ── interview weights ──────────────────────────────────────────────────── */
function WeightsSection({ data, onSaved }: { data: SettingsData; onSaved: () => void }) {
  const [supabase] = useState(() => createClient());
  const latest = data.weights[0];
  const blank = (): Record<WeightKey, string> => Object.fromEntries(WEIGHT_KEYS.map((k) => [k, latest ? String(toPct(latest[k])) : ""])) as Record<WeightKey, string>;
  const [date, setDate] = useState(data.editable_from);
  const [vals, setVals] = useState<Record<WeightKey, string>>(blank);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const pcts = Object.fromEntries(WEIGHT_KEYS.map((k) => [k, Number.isFinite(n(vals[k])) ? n(vals[k]) : null])) as Record<WeightKey, number | null>;
  const total = WEIGHT_KEYS.reduce((s, k) => s + (pcts[k] ?? 0), 0);

  function edit(w: (typeof data.weights)[number]) {
    setDate(w.effective_from); setNote(w.note ?? "");
    setVals(Object.fromEntries(WEIGHT_KEYS.map((k) => [k, String(toPct(w[k]))])) as Record<WeightKey, string>);
  }
  async function save() {
    const errs = weightErrors(pcts);
    if (date < data.editable_from) errs.unshift(`The start date must be ${data.editable_from} or later.`);
    if (errs.length) return setMsg({ ok: false, text: errs.join(" ") });
    setBusy(true); setMsg(null);
    const p: Record<string, unknown> = { effective_from: date, note: note.trim() || null };
    for (const k of WEIGHT_KEYS) p[k] = toFraction(pcts[k] as number);
    const { error } = await supabase.rpc("vsat_settings_weights_set", { p });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: errorText(error.message) });
    setMsg({ ok: true, text: `Saved. Interviews submitted from ${date} will use these weights.` }); onSaved();
  }
  async function remove(d: string) {
    if (!window.confirm(`Remove the weights starting ${d}?`)) return;
    const { error } = await supabase.rpc("vsat_settings_weights_delete", { p: { effective_from: d } });
    if (error) return setMsg({ ok: false, text: errorText(error.message) });
    setMsg({ ok: true, text: "Removed." }); onSaved();
  }

  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold">Interview weights</h2>
      <p className="text-xs text-white/50">An interview uses the set that started on or before the day it is submitted. Only sets starting tomorrow or later can be added, changed or removed.</p>
      <div className="overflow-auto rounded-xl border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/50"><tr>
            <th className="px-3 py-2">From</th>{WEIGHT_KEYS.map((k) => <th key={k} className="px-3 py-2">{WEIGHT_LABEL[k]}</th>)}<th className="px-3 py-2">Total</th><th className="px-3 py-2">Note</th><th className="px-3 py-2" />
          </tr></thead>
          <tbody>{data.weights.map((w) => (
            <tr key={w.effective_from} className="border-t border-white/5">
              <td className="px-3 py-2 tabular-nums">{w.effective_from}</td>
              {WEIGHT_KEYS.map((k) => <td key={k} className="px-3 py-2 tabular-nums">{toPct(w[k])}%</td>)}
              <td className="px-3 py-2 tabular-nums">{Math.round(WEIGHT_KEYS.reduce((s, k) => s + toPct(w[k]), 0) * 100) / 100}%</td>
              <td className="px-3 py-2 text-white/60">{w.note ?? "—"}</td>
              <td className="whitespace-nowrap px-3 py-2">{w.editable
                ? <><button className="text-xs text-[#22d3ee] hover:underline" onClick={() => edit(w)}>Edit</button> <button className="ml-2 text-xs text-rose-300 hover:underline" onClick={() => remove(w.effective_from)}>Remove</button></>
                : <span className="text-xs text-white/35">In use</span>}</td>
            </tr>))}</tbody>
        </table>
      </div>
      <div className={`${card} space-y-3`}>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm"><span className="block text-xs text-white/50">Starts on</span>
            <input type="date" className={input} min={data.editable_from} value={date} onChange={(e) => setDate(e.target.value)} aria-label="Weights start on" /></label>
          {WEIGHT_KEYS.map((k) => (
            <label key={k} className="text-sm"><span className="block text-xs text-white/50">{WEIGHT_LABEL[k]} %</span>
              <input className={num} inputMode="decimal" value={vals[k]} onChange={(e) => setVals((v) => ({ ...v, [k]: e.target.value.replace(/[^\d.]/g, "") }))} aria-label={`${WEIGHT_LABEL[k]} weight`} /></label>
          ))}
          <span className={`pb-2 text-sm tabular-nums ${total >= 50 && total <= 100 ? "text-white/70" : "text-rose-300"}`}>Total {Math.round(total * 100) / 100}%</span>
        </div>
        <input className={`${input} w-full`} placeholder="Note (optional), e.g. Achievements 15% from VSAT-16" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
        <div className="flex items-center gap-3"><button className={primary} disabled={busy} onClick={save}>{busy ? "Saving…" : "Save weights"}</button><Msg m={msg} /></div>
      </div>
    </section>
  );
}

/* ── scholarship bands ──────────────────────────────────────────────────── */
function BandsSection({ data, onSaved }: { data: SettingsData; onSaved: () => void }) {
  const [supabase] = useState(() => createClient());
  const [campus, setCampus] = useState<CampusKey>("pune");
  const [scope, setScope] = useState<string>(""); // "" = default, else exam_date_id
  const rowsFor = useCallback((date: string | null) => data.bands.filter((b) => b.campus === campus && (b.exam_date_id ?? "") === (date ?? "")), [data.bands, campus]);
  const own = rowsFor(scope || null);
  const hasOwn = scope === "" || own.length > 0;
  const source = hasOwn ? own : rowsFor(null);
  const [draft, setDraft] = useState<BandDraft[]>(() => bandsToDraft(source));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const sourceKey = JSON.stringify(source);
  useEffect(() => { setDraft(bandsToDraft(JSON.parse(sourceKey))); setMsg(null); }, [sourceKey]);
  const bands = useMemo(() => draftToBands(draft), [draft]);
  const errs = bandErrors(draft);
  const vsatLabel = data.vsats.find((v) => v.id === scope)?.label;

  function set(i: number, k: keyof BandDraft, v: string) {
    setDraft((d) => d.map((r, j) => (j === i ? { ...r, [k]: Number.isFinite(n(v)) ? n(v) : NaN } : r)));
  }
  async function save(list: ReturnType<typeof draftToBands> | []) {
    if (list.length && errs.length) return setMsg({ ok: false, text: errs.join(" ") });
    setBusy(true); setMsg(null);
    const { error } = await supabase.rpc("vsat_settings_bands_set", { p: { exam_date_id: scope || null, campus, bands: list } });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: errorText(error.message) });
    setMsg({ ok: true, text: list.length ? "Saved." : `${vsatLabel} now uses the default bands.` }); onSaved();
  }

  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold">Scholarship bands</h2>
      <p className="text-xs text-white/50">Each category covers scores from its &quot;Score from&quot; up to where the category above starts. Category 1 ends at 100 and the last one starts at 0, so every score falls in a band. A VSAT uses its own bands if it has them, otherwise the default.</p>
      <div className="flex flex-wrap items-center gap-2">
        <select className={input} value={campus} onChange={(e) => setCampus(e.target.value as CampusKey)} aria-label="Campus"><option value="pune">Pune</option><option value="gurugram">Gurugram</option></select>
        <select className={input} value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Bands for">
          <option value="">Default (all VSATs)</option>
          {data.vsats.map((v) => <option key={v.id} value={v.id}>{v.label}{rowsFor(v.id).length ? " · own bands" : ""}</option>)}
        </select>
      </div>
      {!hasOwn ? (
        <div className={`${card} flex flex-wrap items-center gap-3 text-sm`}>
          <span className="text-white/70">{vsatLabel} uses the default {CAMPUS_LABEL[campus]} bands.</span>
          <button className={ghost} onClick={() => save(draftToBands(bandsToDraft(rowsFor(null))))} disabled={busy}>Give {vsatLabel} its own bands (copy the default)</button>
          <Msg m={msg} />
        </div>
      ) : (
        <div className={`${card} space-y-3`}>
          <div className="overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-white/50"><tr>
                <th className="px-2 py-1">Category</th><th className="px-2 py-1">Score from</th><th className="px-2 py-1">to</th><th className="px-2 py-1">Steps</th>
                <th className="px-2 py-1">Award from %</th><th className="px-2 py-1">to %</th><th className="px-2 py-1">Step values</th>
              </tr></thead>
              <tbody>{draft.map((r, i) => (
                <tr key={i} className="border-t border-white/5">
                  <td className="px-2 py-1 font-semibold">{i + 1}</td>
                  <td className="px-2 py-1">{i === draft.length - 1 ? <span className="tabular-nums text-white/60">0</span>
                    : <input className={num} inputMode="decimal" value={Number.isFinite(r.from) ? r.from : ""} onChange={(e) => set(i, "from", e.target.value)} aria-label={`Category ${i + 1} score from`} />}</td>
                  <td className="px-2 py-1 tabular-nums text-white/60">{bands[i]?.max_score}</td>
                  <td className="px-2 py-1"><input className={num} inputMode="numeric" value={Number.isFinite(r.steps) ? r.steps : ""} onChange={(e) => set(i, "steps", e.target.value)} aria-label={`Category ${i + 1} steps`} /></td>
                  <td className="px-2 py-1"><input className={num} inputMode="decimal" value={Number.isFinite(r.min_award) ? r.min_award : ""} onChange={(e) => set(i, "min_award", e.target.value)} aria-label={`Category ${i + 1} award from`} /></td>
                  <td className="px-2 py-1"><input className={num} inputMode="decimal" value={Number.isFinite(r.max_award) ? r.max_award : ""} onChange={(e) => set(i, "max_award", e.target.value)} aria-label={`Category ${i + 1} award to`} /></td>
                  <td className="px-2 py-1 text-xs text-white/55">{bands[i] && Number.isFinite(bands[i].steps) ? awardSteps(bands[i]).map((x) => `${x}%`).join(" · ") : "—"}</td>
                </tr>))}</tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className={ghost} disabled={draft.length >= 8} onClick={() => setDraft((d) => [...d.slice(0, -1), { ...d[d.length - 1], from: Math.max(1, Math.floor((d[d.length - 2]?.from ?? 100) / 2)) }, { from: 0, steps: 2, min_award: 0, max_award: 5 }])}>Add a category</button>
            <button className={ghost} disabled={draft.length <= 1} onClick={() => setDraft((d) => d.slice(0, -1))}>Remove the last category</button>
            <span className="flex-1" />
            {scope && <button className={`${btn} text-rose-300 hover:underline`} disabled={busy} onClick={() => window.confirm(`${vsatLabel} will go back to the default ${CAMPUS_LABEL[campus]} bands. Continue?`) && save([])}>Use the default instead</button>}
            <button className={primary} disabled={busy || errs.length > 0} onClick={() => save(bands)}>{busy ? "Saving…" : "Save bands"}</button>
          </div>
          {errs.length > 0 && <p className="text-xs text-rose-300">{errs.join(" ")}</p>}
          <Msg m={msg} />
        </div>
      )}
    </section>
  );
}

/* ── per VSAT: VPS curve + cut-off ──────────────────────────────────────── */
function VsatSection({ data, onSaved }: { data: SettingsData; onSaved: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold">VPS curve and &quot;VSAT cleared&quot; cut-off, per VSAT</h2>
      <p className="text-xs text-white/50">Empty means the Exam Center default: curve {anchorsText(data.default_vps_anchors)}, cut-off {data.default_cleared_vps_cutoff ?? "none"}. Change the default in Exam Center.</p>
      <div className="overflow-auto rounded-xl border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/5 text-xs uppercase tracking-wide text-white/50"><tr>
            <th className="px-3 py-2">VSAT</th><th className="px-3 py-2">Date</th><th className="px-3 py-2">Students</th><th className="px-3 py-2">VPS curve (percentile→VPS)</th><th className="px-3 py-2">Cut-off</th><th className="px-3 py-2" />
          </tr></thead>
          <tbody>{data.vsats.map((v) => (
            <VsatRowView key={v.id} v={v} open={open === v.id} onToggle={() => setOpen(open === v.id ? null : v.id)} defaults={data.default_vps_anchors} onSaved={() => { setOpen(null); onSaved(); }} />
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}

function VsatRowView({ v, open, onToggle, defaults, onSaved }: { v: VsatRow; open: boolean; onToggle: () => void; defaults: Anchor[]; onSaved: () => void }) {
  const [supabase] = useState(() => createClient());
  const [useDefault, setUseDefault] = useState(!v.vps_anchors);
  const [pts, setPts] = useState<{ percentile: string; vps: string }[]>(() => (v.vps_anchors ?? defaults).map((a) => ({ percentile: String(a.percentile), vps: String(a.vps) })));
  const [cut, setCut] = useState(v.cleared_vps_cutoff === null ? "" : String(v.cleared_vps_cutoff));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const anchors: Anchor[] = pts.map((p) => ({ percentile: n(p.percentile), vps: n(p.vps) }));

  async function save() {
    const errs = useDefault ? [] : anchorErrors(anchors);
    const c = cut.trim() === "" ? null : n(cut);
    if (c !== null && !(c >= 0 && c <= 10)) errs.push("Cut-off: 0 to 10, or empty.");
    if (errs.length) return setMsg({ ok: false, text: errs.join(" ") });
    setBusy(true); setMsg(null);
    const { error } = await supabase.rpc("vsat_settings_vsat_set", { p: { exam_date_id: v.id, vps_anchors: useDefault ? null : anchors, cleared_vps_cutoff: c } });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: errorText(error.message) });
    onSaved();
  }

  return (
    <>
      <tr className="border-t border-white/5">
        <td className="px-3 py-2 font-medium">{v.label}{!v.enabled && <span className="ml-2 text-xs text-white/40">off</span>}</td>
        <td className="px-3 py-2 tabular-nums text-white/70">{v.exam_date}</td>
        <td className="px-3 py-2 tabular-nums">{v.students}</td>
        <td className="px-3 py-2 text-white/70">{v.vps_anchors ? anchorsText(v.vps_anchors) : <span className="text-white/40">default</span>}</td>
        <td className="px-3 py-2 tabular-nums">{v.cleared_vps_cutoff ?? <span className="text-white/40">default</span>}</td>
        <td className="px-3 py-2"><button className="text-xs text-[#22d3ee] hover:underline" onClick={onToggle}>{open ? "Close" : "Edit"}</button></td>
      </tr>
      {open && (
        <tr className="border-t border-white/5 bg-white/[0.02]"><td colSpan={6} className="space-y-3 px-3 py-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[#34e2b0]" checked={useDefault} onChange={(e) => setUseDefault(e.target.checked)} /> Use the Exam Center default curve</label>
          {!useDefault && (
            <div className="space-y-2">
              {pts.map((p, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="w-16 text-white/50">Point {i + 1}</span>
                  <input className={num} inputMode="decimal" value={p.percentile} onChange={(e) => setPts((x) => x.map((q, j) => (j === i ? { ...q, percentile: e.target.value } : q)))} aria-label={`Point ${i + 1} percentile`} />
                  <span className="text-white/50">percentile →</span>
                  <input className={num} inputMode="decimal" value={p.vps} onChange={(e) => setPts((x) => x.map((q, j) => (j === i ? { ...q, vps: e.target.value } : q)))} aria-label={`Point ${i + 1} VPS`} />
                  <span className="text-white/50">VPS</span>
                  {pts.length > 2 && <button className="text-xs text-rose-300 hover:underline" onClick={() => setPts((x) => x.filter((_, j) => j !== i))}>Remove</button>}
                </div>
              ))}
              {pts.length < 10 && <button className={ghost} onClick={() => setPts((x) => [...x, { percentile: "", vps: "" }])}>Add a point</button>}
            </div>
          )}
          <label className="flex items-center gap-2 text-sm"><span className="text-white/70">&quot;VSAT cleared&quot; VPS cut-off</span>
            <input className={num} inputMode="decimal" placeholder="default" value={cut} onChange={(e) => setCut(e.target.value)} aria-label="Cut-off" /></label>
          <div className="flex items-center gap-3"><button className={primary} disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button><Msg m={msg} /></div>
        </td></tr>
      )}
    </>
  );
}
