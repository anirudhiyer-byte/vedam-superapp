"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

/** Server-computed presence of the Wheebox env credentials (booleans only — the
 *  secret values never leave the server). */
export type WheeboxStatus = { base: boolean; companyCode: boolean; accessToken: boolean; privateKey: boolean; ready: boolean };

type Anchor = { percentile: number; vps: number };
type Settings = { mockTestId: string; osrFormat: string; leadMinutes: number; passVpsCutoff: number | null; vpsAnchors: Anchor[] };

const input = "w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus:border-[#00cfe5] focus:outline-none";
const label = "mb-1 block text-xs font-semibold text-white/60";
const card = "rounded-2xl border border-white/10 bg-white/[0.03] p-5";

const DEFAULT_ANCHORS: Anchor[] = [{ percentile: 0, vps: 0 }, { percentile: 50, vps: 7.5 }, { percentile: 100, vps: 10 }];

const WB_VARS: { key: keyof WheeboxStatus; env: string; desc: string }[] = [
  { key: "base", env: "WHEEBOX_BASE_URL", desc: "API base URL" },
  { key: "companyCode", env: "WHEEBOX_COMPANY_CODE", desc: "UAT / live company code" },
  { key: "accessToken", env: "WHEEBOX_ACCESS_TOKEN", desc: "Access token" },
  { key: "privateKey", env: "WHEEBOX_PRIVATE_KEY", desc: "Private key (AES secret)" },
];

export function VsatExamCenter({ wheebox }: { wheebox: WheeboxStatus }) {
  const [supabase] = useState(() => createClient());
  const [s, setS] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    const { data } = await supabase.rpc("vsat_exam_settings_get");
    setLoading(false);
    if (!data?.ok) { setErr(data?.code === "FORBIDDEN" ? "Admins only." : "Couldn't load settings."); return; }
    const d = data.settings as Record<string, unknown>;
    setS({
      mockTestId: (d.mockTestId as string) ?? "",
      osrFormat: (d.osrFormat as string) ?? "o",
      leadMinutes: d.leadMinutes != null ? Number(d.leadMinutes) : 15,
      passVpsCutoff: d.passVpsCutoff != null ? Number(d.passVpsCutoff) : null,
      vpsAnchors: Array.isArray(d.vpsAnchors) && (d.vpsAnchors as Anchor[]).length ? (d.vpsAnchors as Anchor[]) : DEFAULT_ANCHORS,
    });
  }, [supabase]);
  useEffect(() => { void load(); }, [load]);

  function patch(p: Partial<Settings>) { setS((cur) => (cur ? { ...cur, ...p } : cur)); setMsg(""); }
  function setAnchor(i: number, k: keyof Anchor, v: number) {
    setS((cur) => { if (!cur) return cur; const a = cur.vpsAnchors.slice(); a[i] = { ...a[i], [k]: v }; return { ...cur, vpsAnchors: a }; });
    setMsg("");
  }

  async function save() {
    if (!s) return;
    setErr("");
    // sanity: anchors sorted by percentile, in-range
    const anchors = s.vpsAnchors
      .map((a) => ({ percentile: Number(a.percentile), vps: Number(a.vps) }))
      .filter((a) => Number.isFinite(a.percentile) && Number.isFinite(a.vps))
      .sort((a, b) => a.percentile - b.percentile);
    if (anchors.length < 2) return setErr("Add at least two VPS anchors.");
    if (anchors.some((a) => a.percentile < 0 || a.percentile > 100)) return setErr("Percentiles must be between 0 and 100.");
    setBusy(true);
    const { data } = await supabase.rpc("vsat_exam_settings_set", { p: {
      mockTestId: s.mockTestId.trim(),
      osrFormat: s.osrFormat.trim() || "o",
      leadMinutes: s.leadMinutes,
      passVpsCutoff: s.passVpsCutoff,
      vpsAnchors: anchors,
    } });
    setBusy(false);
    if (!data?.ok) return setErr(data?.code === "INVALID_ANCHORS" ? "VPS anchors are invalid." : data?.code === "FORBIDDEN" ? "Admins only." : "Couldn't save. Try again.");
    setMsg("Saved ✓");
    void load();
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10 text-white">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">VSAT Exam Center</h1>
          <p className="mt-1 text-sm text-white/55">Wheebox connection and scoring settings. Exam slots live under <Link href="/admin/vsat-exam-dates" className="text-[#00cfe5] underline">Exam dates</Link>.</p>
        </div>
      </div>

      {/* ── Wheebox connection (env, read-only) ── */}
      <section className={`${card} mt-6`}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-lg font-semibold">Wheebox connection</h2>
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${wheebox.ready ? "bg-[#16a34a]/15 text-[#5ee9a0]" : "bg-[#f5a623]/15 text-[#ffcf7a]"}`}>
            {wheebox.ready ? "● Connected" : "● Not configured"}
          </span>
        </div>
        <p className="mt-1.5 text-sm text-white/55">Credentials are set as environment variables (Vercel) and are never shown here. Add them to enable exam registration &amp; result sync.</p>
        <div className="mt-4 space-y-2">
          {WB_VARS.map((v) => (
            <div key={v.env} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2.5">
              <div className="min-w-0">
                <code className="text-[13px] text-white/85">{v.env}</code>
                <span className="ml-2 text-xs text-white/40">{v.desc}</span>
              </div>
              <span className={`shrink-0 text-xs font-bold ${wheebox[v.key] ? "text-[#5ee9a0]" : "text-[#ff9db0]"}`}>{wheebox[v.key] ? "✓ Set" : "✗ Missing"}</span>
            </div>
          ))}
        </div>
        {!wheebox.ready && <p className="mt-3 text-xs text-white/45">Exam-registration and result routes stay inert until all four are present — nothing else is affected.</p>}
      </section>

      {/* ── Scoring & exam settings ── */}
      <section className={`${card} mt-5`}>
        <h2 className="font-display text-lg font-semibold">Scoring &amp; exam settings</h2>
        {loading ? (
          <p className="mt-4 text-sm text-white/50">Loading…</p>
        ) : !s ? (
          <p className="mt-4 text-sm text-[#ff9db0]">{err || "Couldn't load settings."}</p>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={label}>Mock test ID</label>
                <input className={input} value={s.mockTestId} onChange={(e) => patch({ mockTestId: e.target.value })} placeholder="Wheebox mock test ID" />
                <p className="mt-1 text-[11px] text-white/35">One mock test, given once per applicant.</p>
              </div>
              <div>
                <label className={label}>OSR format</label>
                <input className={input} value={s.osrFormat} onChange={(e) => patch({ osrFormat: e.target.value })} placeholder="o" />
                <p className="mt-1 text-[11px] text-white/35">Wheebox result-format flag (default &ldquo;o&rdquo;).</p>
              </div>
              <div>
                <label className={label}>Clickable lead (minutes)</label>
                <input type="number" className={input} value={s.leadMinutes} onChange={(e) => patch({ leadMinutes: parseInt(e.target.value || "0", 10) })} min={0} max={240} />
                <p className="mt-1 text-[11px] text-white/35">How early before a slot the exam link becomes clickable.</p>
              </div>
              <div>
                <label className={label}>Pass VPS cutoff (optional)</label>
                <input type="number" step="0.1" className={input} value={s.passVpsCutoff ?? ""} onChange={(e) => patch({ passVpsCutoff: e.target.value === "" ? null : Number(e.target.value) })} placeholder="— none —" />
                <p className="mt-1 text-[11px] text-white/35">Reference cutoff only; pass/fail stays an admin decision.</p>
              </div>
            </div>

            <div>
              <label className={label}>VPS anchors (percentile → VPS, piecewise-linear)</label>
              <div className="space-y-2">
                {s.vpsAnchors.map((a, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input type="number" className={`${input} w-28`} value={a.percentile} onChange={(e) => setAnchor(i, "percentile", Number(e.target.value))} min={0} max={100} />
                    <span className="text-white/40">percentile →</span>
                    <input type="number" step="0.1" className={`${input} w-24`} value={a.vps} onChange={(e) => setAnchor(i, "vps", Number(e.target.value))} />
                    <span className="text-white/40">VPS</span>
                    <button onClick={() => patch({ vpsAnchors: s.vpsAnchors.filter((_, j) => j !== i) })} disabled={s.vpsAnchors.length <= 2}
                      className="ml-auto rounded px-2 py-1 text-xs text-white/40 hover:text-[#ff9db0] disabled:opacity-30">✕</button>
                  </div>
                ))}
              </div>
              <button onClick={() => patch({ vpsAnchors: [...s.vpsAnchors, { percentile: 100, vps: 10 }] })} className="mt-2 rounded-lg border border-dashed border-white/20 px-3 py-1.5 text-xs text-white/60 hover:text-white">+ Add anchor</button>
              <p className="mt-1.5 text-[11px] text-white/35">Raw marks never shown to students — only the computed VPS (0–10).</p>
            </div>

            {err && <p className="text-xs text-[#ff9db0]">{err}</p>}
            <div className="flex items-center gap-3 pt-1">
              <button onClick={save} disabled={busy} className="rounded-lg bg-gradient-to-r from-[#00cfe5] to-[#c200db] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Save settings"}</button>
              {msg && <span className="text-sm text-[#5ee9a0]">{msg}</span>}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
