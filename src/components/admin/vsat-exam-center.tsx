"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { cx, vx } from "@/components/admin/ui/vx";
import { VsatCouponMaker } from "@/components/admin/vsat-coupon-maker";
import { VsatDocUploader } from "@/components/admin/vsat-doc-uploader";
import { VsatLandingToggles } from "@/components/admin/vsat-landing-toggles";
import { VsatCommsPanel } from "@/components/admin/vsat-comms-panel";

/** Server-computed presence of the Wheebox env credentials (booleans only — the
 *  secret values never leave the server). */
export type WheeboxStatus = { base: boolean; companyCode: boolean; accessToken: boolean; privateKey: boolean; ready: boolean };

type Anchor = { percentile: number; vps: number };
type Settings = { mockTestId: string; mockTestName: string; mockDomainName: string; osrFormat: string; leadMinutes: number; passVpsCutoff: number | null; vpsAnchors: Anchor[] };

const input = vx.input;
const label = vx.label;
const card = cx(vx.card, "p-5 sm:p-6");

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
  const [pullMsg, setPullMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    const { data } = await supabase.rpc("vsat_exam_settings_get");
    setLoading(false);
    if (!data?.ok) { setErr(data?.code === "FORBIDDEN" ? "Admins only." : "Couldn't load settings."); return; }
    const d = data.settings as Record<string, unknown>;
    setS({
      mockTestId: (d.mockTestId as string) ?? "",
      mockTestName: (d.mockTestName as string) ?? "",
      mockDomainName: (d.mockDomainName as string) ?? "",
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
      mockTestName: s.mockTestName.trim(),
      mockDomainName: s.mockDomainName.trim(),
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

  // Pull the mock result for every student who has taken the mock, mapped to each student.
  // Not date-scoped (the mock is independent of VSAT dates). Resumable: loop until nothing remains.
  async function pullMock() {
    setBusy(true); setPullMsg("Pulling mock results…");
    let pulled = 0, guard = 0;
    try {
      while (guard++ < 200) {
        const res = await fetch("/api/vsat/exam/pull-mock", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: "{}" });
        const d = await res.json().catch(() => ({}));
        if (!d?.ok) { setPullMsg(d?.code === "WHEEBOX_NOT_CONFIGURED" ? "Wheebox isn't connected (set the env keys above)." : d?.code === "FORBIDDEN" ? "Admins only." : d?.code === "MOCK_NOT_CONFIGURED" ? "Set the mock test ID first." : "Couldn't pull mock results."); break; }
        pulled += d.pulled || 0;
        if (d.total === 0) { setPullMsg("No students have taken the mock yet."); break; }
        if (d.remaining && d.pulled > 0) { setPullMsg(`Pulling mock results: ${pulled} done, ${d.remaining} to go…`); continue; }
        const left = d.remaining || 0;
        setPullMsg(`Pulled ${pulled} mock result${pulled === 1 ? "" : "s"}${left ? `. ${left} still have no result (not submitted yet) — run again later.` : ". ✓"}`); break;
      }
    } catch { setPullMsg("Couldn’t reach the server while pulling mock results."); }
    setBusy(false);
  }

  return (
    <div className="mx-auto w-full max-w-[880px] px-4 py-6 font-sans sm:px-8 sm:py-10 text-vx-ink">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-sans text-[26px] font-semibold leading-tight tracking-[-0.025em] text-vx-ink sm:text-[30px]">VSAT Exam Center</h1>
          <p className="mt-1 text-sm text-vx-mut">Wheebox connection and scoring settings. Exam slots live under <Link href="/admin/vsat-exam-dates" className="text-vx-violet-t underline">Exam dates</Link>.</p>
        </div>
      </div>

      {/* ── Wheebox connection (env, read-only) ── */}
      <section className={`${card} mt-6`}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-sans text-[17px] font-semibold tracking-[-0.01em]">Wheebox connection</h2>
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${wheebox.ready ? "bg-vx-green/15 text-vx-green" : "bg-vx-orange/15 text-vx-orange-t"}`}>
            {wheebox.ready ? "● Connected" : "● Not configured"}
          </span>
        </div>
        <p className="mt-1.5 text-sm text-vx-mut">Credentials are set as environment variables (Vercel) and are never shown here. Add them to enable exam registration &amp; result sync.</p>
        <div className="mt-4 space-y-2">
          {WB_VARS.map((v) => (
            <div key={v.env} className="flex items-center justify-between rounded-lg border border-vx-line bg-black/20 px-3 py-2.5">
              <div className="min-w-0">
                <code className="text-[13px] text-vx-ink">{v.env}</code>
                <span className="ml-2 text-xs text-vx-faint">{v.desc}</span>
              </div>
              <span className={`shrink-0 text-xs font-bold ${wheebox[v.key] ? "text-vx-green" : "text-vx-red"}`}>{wheebox[v.key] ? "✓ Set" : "✗ Missing"}</span>
            </div>
          ))}
        </div>
        {!wheebox.ready && <p className="mt-3 text-xs text-vx-faint">Exam-registration and result routes stay inert until all four are present — nothing else is affected.</p>}
      </section>

      {/* ── Scoring & exam settings ── */}
      <section className={`${card} mt-5`}>
        <h2 className="font-sans text-[17px] font-semibold tracking-[-0.01em]">Scoring &amp; exam settings</h2>
        {loading ? (
          <p className="mt-4 text-sm text-vx-faint">Loading…</p>
        ) : !s ? (
          <p className="mt-4 text-sm text-vx-red">{err || "Couldn't load settings."}</p>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={label}>Mock test ID</label>
                <input className={input} value={s.mockTestId} onChange={(e) => patch({ mockTestId: e.target.value })} placeholder="Wheebox mock test ID" />
                <p className="mt-1 text-[11px] text-vx-faint">One mock test, given once per applicant.</p>
              </div>
              <div>
                <label className={label}>Mock test name <span className="opacity-60">(for results)</span></label>
                <input className={input} value={s.mockTestName} onChange={(e) => patch({ mockTestName: e.target.value })} placeholder="e.g. VSAT Mock" />
                <p className="mt-1 text-[11px] text-vx-faint">Wheebox test name — needed to pull mock results.</p>
              </div>
              <div>
                <label className={label}>Mock domain name <span className="opacity-60">(for results)</span></label>
                <input className={input} value={s.mockDomainName} onChange={(e) => patch({ mockDomainName: e.target.value })} placeholder="e.g. April 2026" />
                <p className="mt-1 text-[11px] text-vx-faint">Wheebox domain name — needed to pull mock results.</p>
              </div>
              <div>
                <label className={label}>OSR format</label>
                <input className={input} value={s.osrFormat} onChange={(e) => patch({ osrFormat: e.target.value })} placeholder="o" />
                <p className="mt-1 text-[11px] text-vx-faint">Wheebox result-format flag (default &ldquo;o&rdquo;).</p>
              </div>
              <div>
                <label className={label}>Clickable lead (minutes)</label>
                <input type="number" className={input} value={s.leadMinutes} onChange={(e) => patch({ leadMinutes: parseInt(e.target.value || "0", 10) })} min={0} max={240} />
                <p className="mt-1 text-[11px] text-vx-faint">How early before a slot the exam link becomes clickable.</p>
              </div>
              <div>
                <label className={label}>Pass VPS cutoff (optional)</label>
                <input type="number" step="0.1" className={input} value={s.passVpsCutoff ?? ""} onChange={(e) => patch({ passVpsCutoff: e.target.value === "" ? null : Number(e.target.value) })} placeholder="— none —" />
                <p className="mt-1 text-[11px] text-vx-faint">Reference cutoff only; pass/fail stays an admin decision.</p>
              </div>
            </div>

            <div>
              <label className={label}>VPS anchors (percentile → VPS, piecewise-linear)</label>
              <div className="space-y-2">
                {s.vpsAnchors.map((a, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input type="number" className={cx(vx.field, "w-28")} value={a.percentile} onChange={(e) => setAnchor(i, "percentile", Number(e.target.value))} min={0} max={100} />
                    <span className="whitespace-nowrap text-vx-faint">percentile →</span>
                    <input type="number" step="0.1" className={cx(vx.field, "w-24")} value={a.vps} onChange={(e) => setAnchor(i, "vps", Number(e.target.value))} />
                    <span className="text-vx-faint">VPS</span>
                    <button onClick={() => patch({ vpsAnchors: s.vpsAnchors.filter((_, j) => j !== i) })} disabled={s.vpsAnchors.length <= 2}
                      className="ml-auto rounded px-2 py-1 text-xs text-vx-faint hover:text-vx-red disabled:opacity-30">✕</button>
                  </div>
                ))}
              </div>
              <button onClick={() => patch({ vpsAnchors: [...s.vpsAnchors, { percentile: 100, vps: 10 }] })} className="mt-2 rounded-lg border border-dashed border-vx-line2 px-3 py-1.5 text-xs text-vx-mut hover:text-vx-ink">+ Add anchor</button>
              <p className="mt-1.5 text-[11px] text-vx-faint">Raw marks never shown to students — only the computed VPS (0–10).</p>
            </div>

            {err && <p className="text-xs text-vx-red">{err}</p>}
            <div className="flex items-center gap-3 pt-1">
              <button onClick={save} disabled={busy} className="rounded-lg bg-[linear-gradient(100deg,#f97d03_0%,#c43ccf_55%,#8a18ff_100%)] shadow-[0_8px_24px_-10px_rgba(196,60,207,0.7)] hover:brightness-110 px-5 py-2.5 text-sm font-semibold text-vx-ink disabled:opacity-50">{busy ? "Saving…" : "Save settings"}</button>
              {msg && <span className="text-sm text-vx-green">{msg}</span>}
            </div>
          </div>
        )}
      </section>

      {/* ── Mock results (global; not tied to a VSAT date) ── */}
      <section className={`${card} mt-5`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-sans text-[17px] font-semibold tracking-[-0.01em]">Mock results</h2>
            <p className="mt-1 text-sm text-vx-mut">Pull the Wheebox mock result for every student who has taken the mock, mapped to each student. The mock isn&apos;t tied to any exam date.</p>
          </div>
          <button onClick={pullMock} disabled={busy} className={cx(vx.btn, vx.cta)}>{busy ? "Pulling…" : "Pull mock results"}</button>
        </div>
        {pullMsg && <p className="mt-3 text-sm text-vx-violet-t">{pullMsg}</p>}
      </section>

      <VsatLandingToggles />
      <VsatCommsPanel />
      <VsatCouponMaker />
      <VsatDocUploader />
    </div>
  );
}
