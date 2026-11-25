"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cx, vx } from "@/components/admin/ui/vx";
import { canManage, errorText, fmtIst, type VsatRoles } from "@/lib/vsat/pipeline";
import { defaultVsat } from "@/lib/vsat/exam-evaluation";
import { pct, rupeesShort } from "@/lib/vsat/counselling-evaluation";
import { awardSteps, bandErrors, bandsToDraft, draftToBands, type BandDraft, type CampusKey } from "@/lib/vsat/settings";
import {
  overallArpu, parseLakh, ruleErrors, sameBands, toLakhText, type ArpuResult, type BucketsData, type SuggestResult,
} from "@/lib/vsat/buckets";

/**
 * Buckets (0188, owner's review 24 Nov 2026) — one VSAT at a time, Pune and Gurugram: the buckets in use, the ARPU now
 * and the ARPU target. Admins change the buckets by hand or ask for a suggestion that meets the target (every award range
 * moves by the same 5-point steps), see the ARPU tiles change as they type (vsat_buckets_preview, nothing saved), save,
 * and lock a VSAT so later changes do not touch it (unlock needs a reason). Admissions see the page read only.
 * Saved counselling forms keep their %.
 */

const VSAT_KEY = "vsat-buckets:vsat";
const LABEL: Record<CampusKey, string> = { pune: "Pune", gurugram: "Gurugram" };
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const num = cx(vx.field, "w-20 tabular-nums");
const toNum = (v: string) => (v.trim() === "" ? NaN : Number(v));

function Tile({ label, value, sub, live }: { label: string; value: string; sub: string; live?: boolean }) {
  return (
    <div className={cx(vx.well, "px-3.5 py-2.5", live && "ring-1 ring-vx-violet/50")}>
      <dt className="text-[12px] text-vx-faint">{label}{live && <span className="ml-1.5 text-vx-violet-t">· not saved</span>}</dt>
      <dd className="mt-0.5 text-[22px] font-semibold tabular-nums tracking-[-0.01em] text-vx-ink">{value}</dd>
      <dd className="text-xs text-vx-faint">{sub}</dd>
    </div>
  );
}

export function BucketsPage({ roles }: { roles: VsatRoles }) {
  const [supabase] = useState(() => createClient());
  const manager = canManage(roles);
  const [vsatId, setVsatId] = useState("");
  const [data, setData] = useState<BucketsData | null>(null);
  const [campus, setCampus] = useState<CampusKey>("pune");
  const [draft, setDraft] = useState<BandDraft[]>([]);
  const [target, setTarget] = useState("");
  const [preview, setPreview] = useState<ArpuResult | null>(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [err, setErr] = useState("");
  const [reason, setReason] = useState("");
  const [reload, setReload] = useState(0);

  // the VSAT list; open on the last one picked here, else the latest whose exam day has come
  useEffect(() => {
    let on = true;
    void supabase.rpc("vsat_buckets_get", { p: {} }).then(({ data: d, error }) => {
      if (!on) return;
      if (error) { setErr(errorText(error.message)); return; }
      const list = ((d as BucketsData).vsats ?? []).map((v) => ({ ...v, exam_date: v.exam_date ?? "" }));
      let saved = "";
      try { saved = localStorage.getItem(VSAT_KEY) ?? ""; } catch { /* storage can be off */ }
      setVsatId(list.some((v) => v.id === saved) ? saved : defaultVsat(list, today()) ?? "");
      setData(d as BucketsData);
    });
    return () => { on = false; };
  }, [supabase]);

  const load = useCallback(async () => {
    if (!vsatId) return;
    setErr("");
    const { data: d, error } = await supabase.rpc("vsat_buckets_get", { p: { exam_date_id: vsatId } });
    if (error) { setErr(errorText(error.message)); return; }
    setData(d as BucketsData);
  }, [supabase, vsatId]);
  useEffect(() => { void load(); }, [load, reload]);

  const cs = data?.campuses.find((c) => c.campus === campus) ?? null;
  const campuses = useMemo(() => data?.campuses ?? [], [data]);
  // the campus tab follows what this person may see (Pune-only admissions see Pune)
  useEffect(() => { if (campuses.length && !campuses.some((c) => c.campus === campus)) setCampus(campuses[0].campus); }, [campuses, campus]);
  // a fresh draft whenever the saved set changes (VSAT, campus or after a save)
  const savedKey = JSON.stringify([vsatId, campus, cs?.bands ?? [], cs?.arpu_target ?? null]);
  useEffect(() => {
    const [, , bands, t] = JSON.parse(savedKey) as [string, string, BucketsData["campuses"][number]["bands"], number | null];
    setDraft(bandsToDraft(bands)); setTarget(toLakhText(t)); setPreview(null); setMsg(null); setReason("");
  }, [savedKey]);

  const bands = useMemo(() => draftToBands(draft), [draft]);
  const structural = bandErrors(draft);
  const rule = ruleErrors(bands);
  const editable = !!data?.can_edit && !!cs && !cs.locked_at;
  const dirty = !!cs && !sameBands(bands, cs.bands);
  const targetValue = target.trim() === "" ? null : parseLakh(target);
  const targetDirty = !!cs && (targetValue ?? null) !== (cs.arpu_target ?? null);

  // live tiles: the edited campus is recalculated from the draft (nothing saved); only that campus's students change
  const bandsKey = JSON.stringify(bands);
  useEffect(() => {
    if (!data?.can_edit || !cs || !dirty || structural.length) { setPreview(null); return; }
    let on = true;
    const t = setTimeout(() => {
      void supabase.rpc("vsat_buckets_preview", { p: { exam_date_id: vsatId, campus, bands: JSON.parse(bandsKey) } }).then(({ data: d, error }) => {
        if (!on) return;
        if (error) { setMsg({ ok: false, text: errorText(error.message) }); setPreview(null); return; }
        setPreview(d as ArpuResult);
      });
    }, 350);
    return () => { on = false; clearTimeout(t); };
  }, [supabase, vsatId, campus, bandsKey, dirty, structural.length, data?.can_edit, cs]);

  const shown = (c: CampusKey): ArpuResult | null =>
    c === campus && preview ? preview : campuses.find((x) => x.campus === c)?.current ?? null;
  const overall = overallArpu(campuses.map((c) => shown(c.campus) ?? { students: 0, arpu: null }));
  const catRow = (cat: number) => (shown(campus)?.categories ?? []).find((x) => x.category === cat);

  function pickVsat(id: string) {
    setVsatId(id);
    try { localStorage.setItem(VSAT_KEY, id); } catch { /* storage can be off */ }
  }
  function set(i: number, k: keyof BandDraft, v: string) {
    setDraft((d) => d.map((r, j) => (j === i ? { ...r, [k]: toNum(v) } : r)));
    setMsg(null);
  }
  async function run(name: string, fn: string, p: Record<string, unknown>): Promise<unknown | null> {
    setBusy(name); setMsg(null);
    const { data: d, error } = await supabase.rpc(fn, { p });
    setBusy("");
    if (error) { setMsg({ ok: false, text: errorText(error.message) }); return null; }
    return d;
  }
  async function suggest() {
    if (targetValue === null) return setMsg({ ok: false, text: "Type the ARPU target in lakh, e.g. 12.5." });
    const p: Record<string, unknown> = { exam_date_id: vsatId, campus, arpu_target: targetValue };
    if (!structural.length) p.bands = bands;
    const r = (await run("suggest", "vsat_buckets_suggest", p)) as SuggestResult | null;
    if (!r) return;
    setDraft(bandsToDraft(r.bands));
    const moved = r.shift === 0 ? "no change to the awards" : `every award range ${r.shift < 0 ? "down" : "up"} ${Math.abs(r.shift)} points`;
    setMsg(r.reached
      ? { ok: true, text: `Suggested: ${moved}. ARPU ${rupeesShort(r.suggested?.arpu)} (target ${rupeesShort(r.arpu_target)}). Check it, change anything by hand, then Save.` }
      : { ok: false, text: `The target can't be met by moving the awards: the highest ARPU possible is ${rupeesShort(r.suggested?.arpu)} (${moved}). Change the buckets by hand or lower the target.` });
  }
  async function save() {
    if (structural.length || rule.length) return setMsg({ ok: false, text: [...structural, ...rule].join(" ") });
    if (target.trim() !== "" && targetValue === null) return setMsg({ ok: false, text: "Type the ARPU target in lakh, e.g. 12.5." });
    const r = await run("save", "vsat_buckets_save", { exam_date_id: vsatId, campus, bands, arpu_target: targetValue });
    if (r) { setReload((n) => n + 1); setMsg({ ok: true, text: `Saved. ${LABEL[campus]} students of this VSAT now get their % from these buckets.` }); }
  }
  async function lock(locked: boolean) {
    if (!locked && reason.trim().length < 3) return setMsg({ ok: false, text: "Write why you are unlocking (at least 3 characters)." });
    const p: Record<string, unknown> = { exam_date_id: vsatId, campus, locked };
    if (reason.trim()) p.reason = reason.trim();
    const r = await run("lock", "vsat_buckets_lock", p);
    if (r) { setReload((n) => n + 1); setMsg({ ok: true, text: locked ? "Locked. Later changes to the default buckets don't touch this VSAT." : "Unlocked." }); }
  }

  if (!manager) return <div className={vx.page}><p className={vx.error}>Only admins and admissions can open Buckets.</p></div>;
  const vsats = data?.vsats ?? [];

  return (
    <div className={vx.page}>
      <div className={vx.head}>
        <div>
          <h1 className={vx.h1}>Buckets</h1>
          <p className={vx.sub}>Per VSAT and campus: the scholarship buckets, the ARPU (fee − scholarship, averaged over the students at PI cleared and after) and its target.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className={vx.label} htmlFor="bk-vsat">VSAT</label>
            <select id="bk-vsat" className={cx(vx.field, "min-w-[12rem]")} value={vsatId} onChange={(e) => pickVsat(e.target.value)} disabled={!vsats.length}>
              {vsats.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
          </div>
          <button className={cx(vx.btn, vx.ghost)} onClick={() => setReload((n) => n + 1)} disabled={!vsatId || !!busy}>Refresh</button>
        </div>
      </div>

      {err && <p className={cx(vx.error, "mb-4")} role="alert">{err}</p>}
      {data && !vsats.length && <p className={vx.note}>No VSAT yet. Add one in Exam Center → Exam dates.</p>}

      {data && data.exam_date_id && (
        <div className="space-y-5">
          {/* ── live ARPU tiles ── */}
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label="ARPU">
            {campuses.map((c) => {
              const a = shown(c.campus);
              return <Tile key={c.campus} label={`${LABEL[c.campus]} ARPU`} value={rupeesShort(a?.arpu)} live={c.campus === campus && !!preview}
                sub={`${a?.students ?? 0} students · average scholarship ${pct(a?.avg_pct)}${c.arpu_target ? ` · target ${rupeesShort(c.arpu_target)}` : ""}`} />;
            })}
            {campuses.length > 1 && <Tile label="Overall ARPU" value={rupeesShort(overall)} live={!!preview}
              sub={`${campuses.reduce((s, c) => s + (shown(c.campus)?.students ?? 0), 0)} students`} />}
          </dl>

          {/* ── campus ── */}
          <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Campus">
            {campuses.map((c) => (
              <button key={c.campus} role="tab" aria-selected={campus === c.campus} onClick={() => setCampus(c.campus)}
                className={cx(vx.btn, campus === c.campus ? vx.primary : vx.secondary)}>{LABEL[c.campus]}</button>
            ))}
          </div>

          {cs && (
            <section className={cx(vx.card, vx.pad, "space-y-4")} aria-labelledby="bk-set">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 id="bk-set" className={vx.h2}>{LABEL[campus]} buckets</h2>
                  <p className={vx.note}>
                    {cs.own ? "This VSAT's own buckets." : "The default buckets (this VSAT has none of its own yet)."}{" "}
                    Programme fee {rupeesShort(cs.fee)}.{" "}
                    {cs.locked_at && <span className={cx(vx.badge, vx.tone.orange)}>Locked{cs.locked_by ? ` by ${cs.locked_by}` : ""} · {fmtIst(cs.locked_at)}</span>}
                  </p>
                </div>
              </div>

              <div className="overflow-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-[12.5px] text-vx-faint"><tr>
                    <th className="px-2 py-1">Category</th><th className="px-2 py-1">Score from</th><th className="px-2 py-1">to</th>
                    <th className="px-2 py-1">Buckets</th><th className="px-2 py-1">Award from %</th><th className="px-2 py-1">to %</th>
                    <th className="px-2 py-1">Bucket values</th><th className="px-2 py-1 text-right">Students</th><th className="px-2 py-1 text-right">Average %</th>
                  </tr></thead>
                  <tbody>{draft.map((r, i) => {
                    const b = bands[i]; const row = catRow(i + 1);
                    return (
                      <tr key={i} className="border-t border-vx-line-soft">
                        <td className="px-2 py-1 font-semibold">{i + 1}</td>
                        <td className="px-2 py-1">{!editable || i === draft.length - 1 ? <span className="tabular-nums">{b?.min_score}</span>
                          : <input className={num} inputMode="decimal" value={Number.isFinite(r.from) ? r.from : ""} onChange={(e) => set(i, "from", e.target.value)} aria-label={`Category ${i + 1} score from`} />}</td>
                        <td className="px-2 py-1 tabular-nums text-vx-mut">{b?.max_score}</td>
                        <td className="px-2 py-1">{editable
                          ? <input className={num} inputMode="numeric" value={Number.isFinite(r.steps) ? r.steps : ""} onChange={(e) => set(i, "steps", e.target.value)} aria-label={`Category ${i + 1} buckets`} />
                          : <span className="tabular-nums">{r.steps}</span>}</td>
                        <td className="px-2 py-1">{editable
                          ? <input className={num} inputMode="decimal" value={Number.isFinite(r.min_award) ? r.min_award : ""} onChange={(e) => set(i, "min_award", e.target.value)} aria-label={`Category ${i + 1} award from`} />
                          : <span className="tabular-nums">{r.min_award}</span>}</td>
                        <td className="px-2 py-1">{editable
                          ? <input className={num} inputMode="decimal" value={Number.isFinite(r.max_award) ? r.max_award : ""} onChange={(e) => set(i, "max_award", e.target.value)} aria-label={`Category ${i + 1} award to`} />
                          : <span className="tabular-nums">{r.max_award}</span>}</td>
                        <td className="px-2 py-1 text-xs text-vx-mut">{b && Number.isFinite(b.steps) && b.steps >= 1 ? awardSteps(b).map((x) => `${x}%`).join(" · ") : "—"}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{row?.students ?? 0}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{pct(row?.avg_pct)}</td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
              {structural.length > 0 && <p className="text-xs text-vx-red">{structural.join(" ")}</p>}

              {data.can_edit && (
                <div className="space-y-3 border-t border-vx-line-soft pt-3">
                  {editable && (
                    <div className="flex flex-wrap items-end gap-2">
                      <div>
                        <label className={vx.label} htmlFor="bk-target">ARPU target (lakh)</label>
                        <input id="bk-target" className={cx(vx.field, "w-28 tabular-nums")} inputMode="decimal" placeholder="e.g. 12.5" value={target}
                          onChange={(e) => { setTarget(e.target.value); setMsg(null); }} />
                      </div>
                      <button className={cx(vx.btn, vx.secondary)} disabled={!!busy || targetValue === null} onClick={() => void suggest()}>
                        {busy === "suggest" ? "Working…" : "Suggest buckets for this target"}
                      </button>
                      <span className="flex-1" />
                      <button className={cx(vx.btn, vx.ghost)} disabled={!!busy || (!dirty && !targetDirty)}
                        onClick={() => { setDraft(bandsToDraft(cs.bands)); setTarget(toLakhText(cs.arpu_target)); setPreview(null); setMsg(null); }}>Undo changes</button>
                      <button className={cx(vx.btn, vx.primary)} disabled={!!busy || (!dirty && !targetDirty) || structural.length > 0 || rule.length > 0}
                        onClick={() => void save()}>{busy === "save" ? "Saving…" : `Save ${LABEL[campus]} buckets`}</button>
                    </div>
                  )}
                  <div className="flex flex-wrap items-end gap-2">
                    {cs.locked_at ? (
                      <>
                        <div className="min-w-[16rem] flex-1">
                          <label className={vx.label} htmlFor="bk-reason">Why unlock? (kept in the audit)</label>
                          <input id="bk-reason" className={vx.field} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
                        </div>
                        <button className={cx(vx.btn, vx.secondary)} disabled={!!busy} onClick={() => void lock(false)}>{busy === "lock" ? "Unlocking…" : "Unlock"}</button>
                      </>
                    ) : (
                      <>
                        <p className="flex-1 text-xs text-vx-faint">Lock this VSAT&apos;s {LABEL[campus]} buckets when they are final: later changes to the default buckets then don&apos;t touch it.{dirty ? " Save or undo your changes first." : ""}</p>
                        <button className={cx(vx.btn, vx.secondary)} disabled={!!busy || dirty}
                          onClick={() => window.confirm(`Lock the ${LABEL[campus]} buckets of this VSAT?`) && void lock(true)}>{busy === "lock" ? "Locking…" : "Lock"}</button>
                      </>
                    )}
                  </div>
                </div>
              )}
              {!data.can_edit && <p className={vx.note}>Only admins change the buckets.</p>}
              {msg && <p className={msg.ok ? vx.ok : vx.error} role="status">{msg.text}</p>}
              <p className="text-xs text-vx-faint">The scholarship score never changes; the category and % follow the buckets. Counselling forms already saved keep the % they were saved with.</p>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
