"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { stageLabel } from "@/lib/growth/consultants-perf";
import {
  SEASON_START, derive, fmtINR, fmtINRk, fmtNum, fmtPct, funnel, perfParams, rangeError, stageCounts, todayIst,
  type Derived, type TgPerfKpi, type TgPerfMeta, type TgStudents,
} from "@/lib/growth/telegram-perf";
import { Icon } from "../consultants/icons";
import { ErrBanner, Loading, Modal, ModalHead } from "../consultants/perf-ui";
import { call, type Client } from "./api";

/**
 * Growth → Telegram Channel → Telegram Performance (migration 0134): the vedamcrm360 "Telegram Dashboard" — tabs Season,
 * Compare Influencers and Campaign, the attribution funnel and the influencer student drill. Admin-only RPCs
 * growth_tg_perf_meta / growth_tg_perf / growth_tg_perf_students; nothing is written from this page.
 */

const TG = "#229ed9", VIOLET = "#8a18ff", MULBERRY = "#e80074", TURQUOISE = "#00cfe5", ORANGE = "#f97d03", GREEN = "#00b85c";

// lucide paths of the CRM's icons (the shared set has no such names)
const TP: Record<string, string> = {
  trend: "M22 7 13.5 15.5 8.5 10.5 2 17M16 7h6v6",
  hash: "M4 9h16M4 15h16M10 3 8 21M16 3l-2 18",
  coins: "M8 14a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM18.09 10.37A6 6 0 1 1 10.34 18M7 6h1v4M16.71 13.88l.7.71-2.82 2.82",
  calc: "M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM8 6h8M16 14v4M16 10h.01M12 10h.01M8 10h.01M12 14h.01M8 14h.01M12 18h.01M8 18h.01",
  card: "M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM2 10h20",
  cap: "M22 10 12 5 2 10l10 5 10-5zM6 12v5c3 3 9 3 12 0v-5",
  ucheck: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM16 11l2 2 4-4",
  act: "M22 12h-4l-3 9L9 3l-3 9H2",
  cmp: "M18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM13 6h3a2 2 0 0 1 2 2v7M11 18H8a2 2 0 0 1-2-2V9",
};
function TIcon({ n, size }: { n: keyof typeof TP; size?: "s" | "xs" | "l" }) {
  return <svg className={`vcn-ico${size ? ` ${size}` : ""}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={TP[n]} /></svg>;
}

type Tab = "season" | "compare" | "campaign";
type Meta = TgPerfMeta;

/** One growth_tg_perf request; null params = nothing asked (empty slot). */
function useKpi(sb: Client, params: Record<string, string> | null) {
  const key = params ? JSON.stringify(params) : "";
  const [st, setSt] = useState<{ key: string; k: Derived | null; err: string }>({ key: "", k: null, err: "" });
  useEffect(() => {
    if (!key) return;
    let alive = true;
    void call<{ kpi: TgPerfKpi }>(sb, "growth_tg_perf", JSON.parse(key)).then((r) => {
      if (alive) setSt({ key, k: r.data ? derive(r.data.kpi) : null, err: r.error ?? "" });
    });
    return () => { alive = false; };
  }, [sb, key]);
  const loading = !!key && st.key !== key;
  return { loading, k: key && !loading ? st.k : null, err: key && !loading ? st.err : "" };
}

export function TelegramPerformance({ sb }: { sb: Client }) {
  const [tab, setTab] = useState<Tab>("season");
  const [meta, setMeta] = useState<Meta>({ campaigns: [], influencers: [] });
  const [metaErr, setMetaErr] = useState("");
  useEffect(() => {
    let alive = true;
    void call<Meta>(sb, "growth_tg_perf_meta", {}).then((r) => {
      if (!alive) return;
      if (r.data) setMeta(r.data); else setMetaErr(r.error ?? "Couldn't load the VSAT and influencer lists.");
    });
    return () => { alive = false; };
  }, [sb]);
  const tabs: { key: Tab; label: string; icon: keyof typeof TP; color: string }[] = [
    { key: "season", label: "Season", icon: "trend", color: TG },
    { key: "compare", label: "Compare Influencers", icon: "cmp", color: VIOLET },
    { key: "campaign", label: "Campaign", icon: "act", color: ORANGE },
  ];
  return (
    <div className="vcn-page vtp">
      <header className="vtp-head">
        <div className="vtp-tile" aria-hidden="true"><TIcon n="trend" size="l" /></div>
        <div>
          <h1 className="vtp-h1">Telegram Dashboard</h1>
          <p className="vtp-sub">Influencer attribution — leads, payments, enrollments, CPL/CPA. VSAT-scoped.</p>
        </div>
      </header>
      <div className="vtp-tabs" role="tablist" aria-label="Telegram Dashboard views">
        {tabs.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`vtp-tab${tab === t.key ? " on" : ""}`}
            style={{ ["--k" as string]: t.color }} onClick={() => setTab(t.key)}>
            <TIcon n={t.icon} /> {t.label}
          </button>
        ))}
      </div>
      {metaErr && <ErrBanner msg={metaErr} />}
      {tab === "season" && <SeasonTab sb={sb} meta={meta} />}
      {tab === "compare" && <CompareTab sb={sb} meta={meta} />}
      {tab === "campaign" && <CampaignTab sb={sb} meta={meta} />}
    </div>
  );
}

// ───────────────────────────── shared bits ─────────────────────────────

function Field({ label, icon, children }: { label: string; icon: ReactNode; children: ReactNode }) {
  return <label className="vtp-f"><span className="vtp-fl">{icon} {label}</span>{children}</label>;
}
function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <Field label={label} icon={<Icon n="calendar" size="xs" />}><input type="date" className="vtp-in" value={value} onChange={(e) => onChange(e.target.value)} /></Field>;
}
function useRange() {
  const [from, setFrom] = useState(SEASON_START);
  const [to, setTo] = useState(() => todayIst());
  return { from, to, setFrom, setTo, err: rangeError(from, to) };
}
function Spinner({ text }: { text?: string }) {
  return <span className="vtp-ld" role="status"><Icon n="loader" size="s" spin />{text && <span>{text}</span>}</span>;
}

function KpiCard({ label, value, accent, icon, onClick }: { label: string; value: string; accent: string; icon: ReactNode; onClick?: () => void }) {
  const body = (
    <>
      <span className="vtp-kh"><span className="vtp-kl">{label}</span><span className="vtp-ki">{icon}</span></span>
      <span className="vtp-kv">{value}</span>
      {onClick && <span className="vtp-kd"><Icon n="right" size="xs" /> drill</span>}
    </>
  );
  const style = { ["--k" as string]: accent };
  return onClick
    ? <button type="button" className="vtp-k go" style={style} onClick={onClick} aria-label={`${label}: ${value}. Open the student list`}>{body}</button>
    : <div className="vtp-k" style={style}>{body}</div>;
}
function MiniStat({ label, value }: { label: string; value: string }) {
  return <div className="vtp-ms"><div className="vtp-msl">{label}</div><div className="vtp-msv">{value}</div></div>;
}

// ───────────────────────────── Season ─────────────────────────────

function SeasonTab({ sb, meta }: { sb: Client; meta: Meta }) {
  const r = useRange();
  const [campaign, setCampaign] = useState("");
  const [influencer, setInfluencer] = useState("");
  const [drill, setDrill] = useState(false);
  const params = r.err ? null : perfParams({ from: r.from, to: r.to, campaign, influencer });
  const { loading, k, err } = useKpi(sb, params);
  const d = k ?? derive(null);
  const open = influencer ? () => setDrill(true) : undefined;
  const f = funnel(d.leads, d.payments, d.enrollments);
  return (
    <div className="vtp-stack">
      <div className="vtp-bar">
        <Field label="Campaign" icon={<TIcon n="act" size="xs" />}>
          <select className="vtp-in vtp-sel" value={campaign} onChange={(e) => setCampaign(e.target.value)}>
            <option value="">All VSATs</option>
            {meta.campaigns.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Influencer" icon={<Icon n="users" size="xs" />}>
          <select className="vtp-in vtp-sel" value={influencer} onChange={(e) => setInfluencer(e.target.value)}>
            <option value="">All influencers</option>
            {meta.influencers.map((i) => <option key={i.key} value={i.key}>{i.name}</option>)}
          </select>
        </Field>
        <DateField label="From" value={r.from} onChange={r.setFrom} />
        <DateField label="To" value={r.to} onChange={r.setTo} />
        <div className="vtp-grow" />
        {loading && <Spinner text="Loading…" />}
      </div>
      {r.err && <ErrBanner msg={r.err} />}
      {err && <ErrBanner msg={err} />}
      <div className="vtp-kpis">
        <KpiCard label="Influencers" value={fmtNum(d.influencers)} accent={VIOLET} icon={<Icon n="users" />} onClick={open} />
        <KpiCard label="Unique UTMs" value={fmtNum(d.utms)} accent={TG} icon={<TIcon n="hash" />} />
        <KpiCard label="Total Spend" value={fmtINRk(d.total_spend)} accent={ORANGE} icon={<TIcon n="coins" />} />
        <KpiCard label="Overall CPL" value={fmtINR(d.overall_cpl)} accent={TURQUOISE} icon={<TIcon n="calc" />} />
        <KpiCard label="Overall CPA" value={fmtINR(d.overall_cpa)} accent={MULBERRY} icon={<TIcon n="calc" />} />
        <KpiCard label="Leads" value={fmtNum(d.leads)} accent={GREEN} icon={<TIcon n="ucheck" />} onClick={open} />
        <KpiCard label="Payments" value={fmtNum(d.payments)} accent={MULBERRY} icon={<TIcon n="card" />} onClick={open} />
        <KpiCard label="Enrollments" value={fmtNum(d.enrollments)} accent={ORANGE} icon={<TIcon n="cap" />} />
        <KpiCard label="L2P %" value={fmtPct(d.l2p)} accent={VIOLET} icon={<TIcon n="trend" />} />
      </div>
      <section className="vtp-fun" aria-label="Attribution funnel">
        <div className="vtp-funh">Attribution Funnel</div>
        <FunnelBar label="Leads" value={fmtNum(d.leads)} width={f.leads} accent={GREEN} />
        <FunnelBar label="Payments" value={fmtNum(d.payments)} width={f.payments} accent={MULBERRY} sub={`${f.paidRate}% of leads`} />
        <FunnelBar label="Enrolled" value={fmtNum(d.enrollments)} width={f.enrollments} accent={ORANGE} sub={`${f.enrolRate}% of payments`} />
      </section>
      {!influencer && <div className="vtp-hint"><Icon n="right" size="s" /> Pick a single influencer to drill into their student list.</div>}
      {drill && influencer && (
        <Drill sb={sb} influencer={influencer} name={meta.influencers.find((i) => i.key === influencer)?.name ?? influencer}
          params={perfParams({ from: r.from, to: r.to, campaign, influencer })} onClose={() => setDrill(false)} />
      )}
    </div>
  );
}

function FunnelBar({ label, value, width, accent, sub }: { label: string; value: string; width: number; accent: string; sub?: string }) {
  const inside = width > 22;
  return (
    <div className="vtp-fr" style={{ ["--k" as string]: accent }}>
      <div><div className="vtp-frl">{label}</div>{sub && <div className="vtp-frs">{sub}</div>}</div>
      <div className="vtp-trk">
        <div className="vtp-fill" style={{ width: `${width}%` }}>{inside && <span>{value}</span>}</div>
        {!inside && <span className="vtp-out" style={{ left: `calc(${width}% + 12px)` }}>{value}</span>}
      </div>
    </div>
  );
}

// ───────────────────────────── Compare Influencers ─────────────────────────────

function CompareTab({ sb, meta }: { sb: Client; meta: Meta }) {
  const r = useRange();
  return (
    <div className="vtp-stack">
      <div className="vtp-bar">
        <DateField label="From" value={r.from} onChange={r.setFrom} />
        <DateField label="To" value={r.to} onChange={r.setTo} />
        <div className="vtp-note">Date range applies to both sides.</div>
      </div>
      {r.err && <ErrBanner msg={r.err} />}
      <div className="vtp-two">
        <CompareSlot sb={sb} slot="A" accent={VIOLET} meta={meta} from={r.from} to={r.to} off={!!r.err} />
        <CompareSlot sb={sb} slot="B" accent={ORANGE} meta={meta} from={r.from} to={r.to} off={!!r.err} />
      </div>
    </div>
  );
}

function CompareSlot({ sb, slot, accent, meta, from, to, off }: { sb: Client; slot: string; accent: string; meta: Meta; from: string; to: string; off: boolean }) {
  const [influencer, setInfluencer] = useState("");
  const [campaign, setCampaign] = useState("");
  const { loading, k, err } = useKpi(sb, influencer && !off ? perfParams({ from, to, campaign, influencer }) : null);
  const d = k ?? derive(null);
  return (
    <section className="vtp-slot" style={{ ["--k" as string]: accent }} aria-label={`Side ${slot}`}>
      <div className="vtp-sh">
        <div className="vtp-tag">Side {slot}</div>
        <select className="vtp-in sm grow" aria-label={`Side ${slot} influencer`} value={influencer} onChange={(e) => setInfluencer(e.target.value)}>
          <option value="">— Influencer —</option>
          {meta.influencers.map((i) => <option key={i.key} value={i.key}>{i.name}</option>)}
        </select>
        <select className="vtp-in sm" aria-label={`Side ${slot} VSAT`} value={campaign} onChange={(e) => setCampaign(e.target.value)}>
          <option value="">All VSATs</option>
          {meta.campaigns.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
        </select>
        {loading && <Spinner />}
      </div>
      {!influencer ? <div className="vtp-empty">Pick an influencer to populate.</div> : err ? <div className="vtp-empty err" role="alert">{err}</div> : (
        <div className="vtp-grid">
          <MiniStat label="UTMs" value={fmtNum(d.utms)} />
          <MiniStat label="Leads" value={fmtNum(d.leads)} />
          <MiniStat label="Payments" value={fmtNum(d.payments)} />
          <MiniStat label="Enrollments" value={fmtNum(d.enrollments)} />
          <MiniStat label="Total Spend" value={fmtINRk(d.total_spend)} />
          <MiniStat label="L2P" value={fmtPct(d.l2p)} />
          <MiniStat label="Overall CPL" value={fmtINR(d.overall_cpl)} />
          <MiniStat label="Overall CPA" value={fmtINR(d.overall_cpa)} />
        </div>
      )}
    </section>
  );
}

// ───────────────────────────── Campaign ─────────────────────────────

function CampaignTab({ sb, meta }: { sb: Client; meta: Meta }) {
  const r = useRange();
  return (
    <div className="vtp-stack">
      <div className="vtp-bar">
        <DateField label="From" value={r.from} onChange={r.setFrom} />
        <DateField label="To" value={r.to} onChange={r.setTo} />
        <div className="vtp-note">Compare two VSAT campaigns.</div>
      </div>
      {r.err && <ErrBanner msg={r.err} />}
      <div className="vtp-two">
        <CampaignSlot sb={sb} slot="A" accent={VIOLET} meta={meta} from={r.from} to={r.to} off={!!r.err} />
        <CampaignSlot sb={sb} slot="B" accent={ORANGE} meta={meta} from={r.from} to={r.to} off={!!r.err} />
      </div>
    </div>
  );
}

function CampaignSlot({ sb, slot, accent, meta, from, to, off }: { sb: Client; slot: string; accent: string; meta: Meta; from: string; to: string; off: boolean }) {
  const [campaign, setCampaign] = useState("");
  const { loading, k, err } = useKpi(sb, campaign && !off ? perfParams({ from, to, campaign }) : null);
  const d = k ?? derive(null);
  return (
    <section className="vtp-slot" style={{ ["--k" as string]: accent }} aria-label={`Campaign ${slot}`}>
      <div className="vtp-sh">
        <div className="vtp-tag">Campaign {slot}</div>
        <select className="vtp-in sm grow" aria-label={`Campaign ${slot}`} value={campaign} onChange={(e) => setCampaign(e.target.value)}>
          <option value="">— Select VSAT —</option>
          {meta.campaigns.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
        </select>
        {loading && <Spinner />}
      </div>
      {!campaign ? <div className="vtp-empty">Pick a VSAT to populate.</div> : err ? <div className="vtp-empty err" role="alert">{err}</div> : (
        <div className="vtp-grid">
          <MiniStat label="Influencers Live" value={fmtNum(d.influencers)} />
          <MiniStat label="UTMs Live" value={fmtNum(d.utms)} />
          <MiniStat label="Leads" value={fmtNum(d.leads)} />
          <MiniStat label="Payments" value={fmtNum(d.payments)} />
          <MiniStat label="Enrollments" value={fmtNum(d.enrollments)} />
          <MiniStat label="L2P" value={fmtPct(d.l2p)} />
          <MiniStat label="Overall CPP" value={fmtINR(d.overall_cpp)} />
          <MiniStat label="Overall CPL" value={fmtINR(d.overall_cpl)} />
          <MiniStat label="Total Spend" value={fmtINRk(d.total_spend)} />
        </div>
      )}
    </section>
  );
}

// ───────────────────────────── Influencer drill ─────────────────────────────

function Drill({ sb, influencer, name, params, onClose }: { sb: Client; influencer: string; name: string; params: Record<string, string>; onClose: () => void }) {
  const key = JSON.stringify(params);
  const [st, setSt] = useState<{ key: string; data: TgStudents | null; err: string }>({ key: "", data: null, err: "" });
  useEffect(() => {
    let alive = true;
    void call<TgStudents>(sb, "growth_tg_perf_students", JSON.parse(key)).then((r) => { if (alive) setSt({ key, data: r.data, err: r.error ?? "" }); });
    return () => { alive = false; };
  }, [sb, key, influencer]);
  const loading = st.key !== key;
  const rows = useMemo(() => (loading ? [] : st.data?.students ?? []), [loading, st.data]);
  const stages = useMemo(() => stageCounts(rows), [rows]);
  return (
    <Modal label={`Influencer drill: ${name}`} size="big" onClose={onClose}>
      <ModalHead color={TG} onClose={onClose} eyebrow="Influencer Drill" title={name} sub={loading ? "Loading…" : `${fmtNum(st.data?.total ?? rows.length)} students`} />
      {loading ? <div className="vcp-mb"><Loading text="Loading students…" color={TG} /></div> : st.err ? (
        <div className="vcp-mb"><div className="vcn-empty" role="alert"><b>Couldn&apos;t load the students.</b><span>{st.err}</span></div></div>
      ) : (
        <div className="vtp-dbody">
          <div className="vtp-dt">
            {st.data?.truncated && <div className="vcp-trunc">Showing the latest {fmtNum(rows.length)} of {fmtNum(st.data.total)} students. Narrow the dates or pick a VSAT to see the rest.</div>}
            <table className="vcn-t vtp-t">
              <thead><tr>{["Name", "Email", "Mobile", "Stage", "Payment", "Campus"].map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
              <tbody>
                {rows.length === 0 ? <tr><td colSpan={6} className="vtp-none">No students found.</td></tr> : rows.map((s) => (
                  <tr key={s.lead_id}>
                    <td className="nm">{s.name || "—"}</td>
                    <td className="em" title={s.email ?? ""}>{s.email || "—"}</td>
                    <td className="num">{s.mobile || "—"}</td>
                    <td className={`st${s.stage === "enrolled" ? " enr" : ""}`}>{stageLabel(s.stage)}</td>
                    <td>{s.payment_status || "—"}</td>
                    <td>{s.campus_preference || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <aside className="vtp-side" aria-label="Stage breakdown">
            <div className="vcp-sth"><Icon n="branch" size="s" /> Stage Breakdown</div>
            {stages.length === 0 ? <div className="vtp-none">No stages.</div> : stages.map(([stage, count]) => (
              <div key={stage} className={`vtp-stg${stage === "enrolled" ? " enr" : ""}`}>
                <span>{stageLabel(stage)}</span><b>{fmtNum(count)}</b>
              </div>
            ))}
          </aside>
        </div>
      )}
    </Modal>
  );
}
