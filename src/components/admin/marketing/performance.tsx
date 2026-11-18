"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AD_PLATFORMS, INFL_PLATFORMS, MIN_LEADS, bestV2l, fillWeeks, fmtCompact, fmtDate, fmtInr, fmtInt, fmtPct, groupTotals, highestL2p,
  isYouTube, lowestCpp, metrics, totals, type Best, type Campaign, type Channel, type Meta, type Metrics, type PerfRow, type Week,
} from "@/lib/growth/marketing";
import { Card, Err, ExtLink, Funnel, Tabs, WeeklyCompare, rpc, type Client } from "./shared";

/**
 * Ad Performance + Influencer Performance. Numbers come from growth_perf (migration 0105):
 *   • a campaign filter = the leads that arrived in that campaign's window (the cohort) and only
 *     their payments / enrollments
 *   • no campaign: the date range counts leads by arrival date, payments by paid date and
 *     enrollments by enrolment date, whichever VSAT they belong to
 * Totals count each UTM once (per UTM + campaign in a campaign view).
 */

const yearAgo = () => { const d = new Date(); d.setFullYear(d.getFullYear() - 1); return d.toISOString().slice(0, 10); };
type Filters = { from: string; to: string; campaign: string; live: "live" | "planned" | "all" };

function usePerf(sb: Client, channel: Channel, f: { from: string; to: string; campaign_ids: string[] | null; live?: string }, enabled = true) {
  const [rows, setRows] = useState<PerfRow[] | null>(null);
  const [err, setErr] = useState("");
  const key = JSON.stringify(f);
  useEffect(() => {
    if (!enabled) return;
    let on = true;
    setRows(null);
    const p: Record<string, unknown> = { channel, from: f.from || null, to: f.to || null, campaign_ids: f.campaign_ids };
    if (channel === "influencers") p.live = f.live ?? "all";
    void rpc<{ rows: PerfRow[] }>(sb, "growth_perf", p).then((r) => {
      if (!on) return;
      if (r.error || !r.data) { setErr(r.error ?? "Could not load."); setRows([]); return; }
      setErr(""); setRows(r.data.rows);
    });
    return () => { on = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the serialised filter
  }, [sb, channel, key, enabled]);
  return { rows, err };
}

function FilterBar({ f, setF, meta, channel, extra }: { f: Filters; setF: (f: Filters) => void; meta: Meta; channel: Channel; extra?: ReactNode }) {
  return (
    <div className="mk-bar">
      <span className="mk-lbl">From</span>
      <input className="mk-in mk-date" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} aria-label="From" />
      <span className="mk-lbl">To</span>
      <input className="mk-in mk-date" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} aria-label="To" />
      <select className="mk-sel" value={f.campaign} onChange={(e) => setF({ ...f, campaign: e.target.value })} aria-label="Campaign">
        <option value="">All campaigns</option>{meta.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      {channel === "influencers" && (
        <select className="mk-sel" value={f.live} onChange={(e) => setF({ ...f, live: e.target.value as Filters["live"] })} aria-label="Live status">
          <option value="live">Live only</option><option value="planned">Planned only</option><option value="all">Live + planned</option>
        </select>
      )}
      {extra}
      <span style={{ flex: 1 }} />
      <button className="mk-btn" onClick={() => setF({ from: yearAgo(), to: "", campaign: "", live: "live" })}>Reset</button>
    </div>
  );
}

const Note = ({ campaign }: { campaign: boolean }) => (
  <p className="mk-note">
    {campaign
      ? "Campaign view: only the leads that arrived inside the campaign dates, and their payments and enrollments (whenever they happened). The From / To dates narrow those leads further."
      : "Date view: leads by the day they arrived, payments by the day they paid and enrollments by the day they enrolled, whatever VSAT they belong to. Rows that went live in the dates or had activity in them are included."}
    {` Best L2P / V2L need at least ${MIN_LEADS} leads.`}
  </p>
);

function TopCard({ title, best, value, who, link }: { title: string; best: Best; value: (b: NonNullable<Best>) => string; who: (b: NonNullable<Best>) => string; link: (b: NonNullable<Best>) => string | null }) {
  return (
    <div className="mk-topc">
      <div className="mk-cl">{title}</div>
      {best ? (
        <>
          <div className="mk-cv">{value(best)}</div>
          <div className="mk-topn" title={who(best)}><ExtLink href={link(best)}>{who(best)}</ExtLink></div>
          <div className="mk-cs">{fmtInr(best.m.spend)} spend · {fmtInt(best.m.leads)} leads · {fmtInt(best.m.payments)} payments</div>
        </>
      ) : <div className="mk-cs">Not enough data yet.</div>}
    </div>
  );
}

function MetricCards({ m, extra }: { m: Metrics; extra?: ReactNode }) {
  return (
    <div className="mk-cards">
      {extra}
      <Card label="Leads" value={fmtInt(m.leads)} />
      <Card label="Payments" value={fmtInt(m.payments)} sub={`L2P ${fmtPct(m.l2p)}`} />
      <Card label="Enrollments" value={fmtInt(m.enrollments)} sub={`${fmtPct(m.p2e)} of payments`} />
      <Card label="Total spend" value={fmtInr(m.spend)} accent />
      <Card label="CPL" value={fmtInr(m.cpl)} sub="spend / leads" />
      <Card label="CPP" value={fmtInr(m.cpp)} sub="spend / payments" />
    </div>
  );
}

function GroupTable({ title, groups, label }: { title: string; groups: { key: string; m: Metrics; rows: PerfRow[] }[]; label: (k: string) => string }) {
  return (
    <div className="mk-box">
      <h4>{title}</h4>
      <div className="mk-tablewrap" style={{ maxHeight: 360 }}>
        <table className="mk-table">
          <thead><tr><th>{title.replace(/^By /, "")}</th><th className="r">Rows</th><th className="r">Spend</th><th className="r">Leads</th><th className="r">Payments</th><th className="r">Enrollments</th><th className="r">CPL</th><th className="r">CPP</th><th className="r">L2P</th></tr></thead>
          <tbody>
            {groups.length === 0 && <tr><td colSpan={9} className="mk-mid">No data for these filters.</td></tr>}
            {groups.map((g) => (
              <tr key={g.key}>
                <td className="mk-strong">{label(g.key)}</td><td className="r">{g.rows.length}</td><td className="r">{fmtInr(g.m.spend)}</td>
                <td className="r">{fmtInt(g.m.leads)}</td><td className="r">{fmtInt(g.m.payments)}</td><td className="r">{fmtInt(g.m.enrollments)}</td>
                <td className="r">{fmtInr(g.m.cpl)}</td><td className="r">{fmtInr(g.m.cpp)}</td><td className="r">{fmtPct(g.m.l2p)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const campName = (meta: Meta) => (k: string) => meta.campaigns.find((c) => c.id === k)?.name ?? (k === "-" ? "No campaign" : k);

// ═════════════════════════════════════ ADS ═════════════════════════════════════

type AdTab = "season" | "platform" | "compare" | "list";

export function AdsPerformance({ sb, meta }: { sb: Client; meta: Meta }) {
  const [f, setF] = useState<Filters>({ from: yearAgo(), to: "", campaign: "", live: "all" });
  const [plat, setPlat] = useState("");
  const [tab, setTab] = useState<AdTab>("season");
  const { rows, err } = usePerf(sb, "ads", { from: f.from, to: f.to, campaign_ids: f.campaign ? [f.campaign] : null });
  const perCamp = !!f.campaign;
  const all = useMemo(() => (rows ?? []).filter((r) => !plat || r.platform === plat), [rows, plat]);

  return (
    <div className="mk-page">
      <div className="mk-head"><div><h2>Ad Performance</h2><p>Season, platform and per-ad performance for Meta + Google ads. Numbers are live from the Ads listing.</p></div></div>
      <FilterBar f={f} setF={setF} meta={meta} channel="ads" extra={
        <select className="mk-sel" value={plat} onChange={(e) => setPlat(e.target.value)} aria-label="Platform"><option value="">All platforms</option>{AD_PLATFORMS.map((p) => <option key={p}>{p}</option>)}</select>
      } />
      <Err msg={err} />
      <Tabs<AdTab> value={tab} onChange={setTab} tabs={[{ id: "season", label: "Season Performance" }, { id: "platform", label: "Platform Performance" }, { id: "compare", label: "Ad Comparison" }, { id: "list", label: "Performance List" }]} />
      {rows === null ? <p className="mk-mid">Loading…</p> : (
        <>
          {tab === "season" && <AdSeason rows={all} perCamp={perCamp} meta={meta} />}
          {tab === "platform" && <AdPlatform rows={rows} perCamp={perCamp} meta={meta} />}
          {tab === "compare" && <AdCompare rows={rows} perCamp={perCamp} meta={meta} />}
          {tab === "list" && <AdList rows={all} />}
        </>
      )}
      <Note campaign={perCamp} />
    </div>
  );
}

function AdSeason({ rows, perCamp, meta }: { rows: PerfRow[]; perCamp: boolean; meta: Meta }) {
  const m = totals(rows, perCamp);
  const uniq = new Set(rows.map((r) => r.utm_key ?? `row:${r.id}`)).size;
  return (
    <>
      <MetricCards m={m} extra={<><Card label="Unique ads" value={fmtInt(uniq)} sub="by UTM" /><Card label="L2P" value={fmtPct(m.l2p)} sub="leads → payments" /></>} />
      <div className="mk-top">
        <TopCard title="Lowest CPP" best={lowestCpp(rows)} value={(b) => fmtInr(b.m.cpp)} who={(b) => b.row.label} link={(b) => b.row.utm_link} />
        <TopCard title={`Highest L2P (≥ ${MIN_LEADS} leads)`} best={highestL2p(rows)} value={(b) => fmtPct(b.m.l2p)} who={(b) => b.row.label} link={(b) => b.row.utm_link} />
      </div>
      <div className="mk-box"><h4>Funnel</h4><Funnel steps={[{ label: "Leads", value: m.leads }, { label: "Payments", value: m.payments }, { label: "Enrollments", value: m.enrollments }]} /></div>
      <GroupTable title="By campaign" groups={groupTotals(rows, (r) => r.campaign_id ?? "-", perCamp)} label={campName(meta)} />
      <GroupTable title="By platform" groups={groupTotals(rows, (r) => r.platform, perCamp)} label={(k) => k} />
    </>
  );
}

function AdPlatform({ rows, perCamp, meta }: { rows: PerfRow[]; perCamp: boolean; meta: Meta }) {
  const [p, setP] = useState<string>("Meta");
  const sub = rows.filter((r) => r.platform === p);
  const m = totals(sub, perCamp);
  return (
    <>
      <div className="mk-bar">{AD_PLATFORMS.map((x) => <button key={x} className={x === p ? "mk-pri" : "mk-btn"} onClick={() => setP(x)}>{x}</button>)}</div>
      <MetricCards m={m} extra={<Card label="Unique ads" value={fmtInt(new Set(sub.map((r) => r.utm_key ?? `row:${r.id}`)).size)} sub="by UTM" />} />
      <div className="mk-top">
        <TopCard title="Lowest CPP" best={lowestCpp(sub)} value={(b) => fmtInr(b.m.cpp)} who={(b) => b.row.label} link={(b) => b.row.utm_link} />
        <TopCard title={`Highest L2P (≥ ${MIN_LEADS} leads)`} best={highestL2p(sub)} value={(b) => fmtPct(b.m.l2p)} who={(b) => b.row.label} link={(b) => b.row.utm_link} />
      </div>
      <div className="mk-box"><h4>Funnel · {p}</h4><Funnel steps={[{ label: "Leads", value: m.leads }, { label: "Payments", value: m.payments }, { label: "Enrollments", value: m.enrollments }]} /></div>
      <GroupTable title="By campaign" groups={groupTotals(sub, (r) => r.campaign_id ?? "-", perCamp)} label={campName(meta)} />
    </>
  );
}

type Side = { ad: string; campaign: string; platform: string };
function AdCompare({ rows, perCamp, meta }: { rows: PerfRow[]; perCamp: boolean; meta: Meta }) {
  const [a, setA] = useState<Side>({ ad: "", campaign: "", platform: "" });
  const [b, setB] = useState<Side>({ ad: "", campaign: "", platform: "" });
  const ads = useMemo(() => [...new Map(rows.map((r) => [r.id, r.label])).entries()].sort((x, y) => x[1].localeCompare(y[1])), [rows]);
  const pick = (s: Side) => rows.filter((r) => (!s.ad || r.id === s.ad) && (!s.campaign || r.campaign_id === s.campaign) && (!s.platform || r.platform === s.platform));
  const side = (s: Side, set: (s: Side) => void, tone: "a" | "b", name: string) => {
    const sub = pick(s);
    const cols: [string, Metrics][] = [["Total", totals(sub, perCamp)], ...AD_PLATFORMS.map((p) => [p, totals(sub.filter((r) => r.platform === p), perCamp)] as [string, Metrics])];
    const line = (label: string, f: (m: Metrics) => string) => <tr key={label}><td>{label}</td>{cols.map(([k, m]) => <td key={k} className="v">{f(m)}</td>)}</tr>;
    return (
      <div className={`mk-box mk-box-${tone}`}>
        <h4>{name}</h4>
        <div className="mk-bar" style={{ marginBottom: 10 }}>
          <select className="mk-sel" value={s.ad} onChange={(e) => set({ ...s, ad: e.target.value })} aria-label={`${name} ad`}><option value="">All ads</option>{ads.map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select>
          <select className="mk-sel" value={s.campaign} onChange={(e) => set({ ...s, campaign: e.target.value })} aria-label={`${name} campaign`}><option value="">All campaigns</option>{meta.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <select className="mk-sel" value={s.platform} onChange={(e) => set({ ...s, platform: e.target.value })} aria-label={`${name} platform`}><option value="">All platforms</option>{AD_PLATFORMS.map((p) => <option key={p}>{p}</option>)}</select>
        </div>
        <table className="mk-table mk-cmp">
          <thead><tr><th />{cols.map(([k]) => <th key={k} className="r">{k}</th>)}</tr></thead>
          <tbody>
            {line("Spend", (m) => fmtInr(m.spend))}{line("CPL", (m) => fmtInr(m.cpl))}{line("CPP", (m) => fmtInr(m.cpp))}{line("L2P", (m) => fmtPct(m.l2p))}
            {line("Leads", (m) => fmtInt(m.leads))}{line("Payments", (m) => fmtInt(m.payments))}{line("Enrollments", (m) => fmtInt(m.enrollments))}
          </tbody>
        </table>
      </div>
    );
  };
  return (
    <>
      <p className="mk-note">Pick filters on each side to compare two ads, campaigns or platforms. Total / Meta / Google split the side&apos;s rows by platform.</p>
      <div className="mk-grid2">{side(a, setA, "a", "Side A")}{side(b, setB, "b", "Side B")}</div>
    </>
  );
}

type RankKey = "cpp" | "cpl" | "l2p" | "leads" | "payments" | "enrollments" | "spend";
const RANK: { id: RankKey; label: string; better: "low" | "high" }[] = [
  { id: "cpp", label: "CPP", better: "low" }, { id: "cpl", label: "CPL", better: "low" }, { id: "l2p", label: "L2P %", better: "high" },
  { id: "leads", label: "Leads", better: "high" }, { id: "payments", label: "Payments", better: "high" }, { id: "enrollments", label: "Enrollments", better: "high" },
  { id: "spend", label: "Spend", better: "high" },
];

function AdList({ rows }: { rows: PerfRow[] }) {
  const [by, setBy] = useState<RankKey>("cpp");
  const [best, setBest] = useState(true);
  const list = useMemo(() => {
    const spec = RANK.find((r) => r.id === by)!;
    const withM = rows.map((r) => ({ r, m: metrics(Number(r.cost) || 0, r.leads, r.payments, r.enrollments) }));
    const val = (m: Metrics) => m[by];
    const dir = (spec.better === "low") === best ? 1 : -1;
    return withM.sort((x, y) => {
      const a = val(x.m), b = val(y.m);
      if (a === null && b === null) return 0;
      if (a === null) return 1;
      if (b === null) return -1;
      return (a - b) * dir;
    });
  }, [rows, by, best]);
  return (
    <>
      <div className="mk-bar">
        <span className="mk-lbl">Rank by</span>
        <select className="mk-sel" value={by} onChange={(e) => setBy(e.target.value as RankKey)} aria-label="Rank by">{RANK.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
        <button className="mk-btn" onClick={() => setBest(!best)}>{best ? "Best first" : "Worst first"}</button>
      </div>
      <div className="mk-tablewrap">
        <table className="mk-table">
          <thead><tr><th>#</th><th>Ad name</th><th>Platform</th><th>Campaign</th><th>UTM</th><th className="r">Spend</th><th className="r">Leads</th><th className="r">Payments</th><th className="r">Enrollments</th><th className="r">CPL</th><th className="r">CPP</th><th className="r">L2P</th></tr></thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={12} className="mk-mid">No ads for these filters.</td></tr>}
            {list.map(({ r, m }, i) => (
              <tr key={r.id}>
                <td>{i + 1}</td><td className="mk-strong">{r.label}</td><td>{r.platform}</td><td>{r.campaign ?? "—"}</td>
                <td><ExtLink href={r.utm_link}><span className="mk-trunc">{r.utm_link ?? "—"}</span></ExtLink></td>
                <td className="r">{fmtInr(m.spend)}</td><td className="r">{fmtInt(m.leads)}</td><td className="r">{fmtInt(m.payments)}</td><td className="r">{fmtInt(m.enrollments)}</td>
                <td className="r">{fmtInr(m.cpl)}</td><td className="r">{fmtInr(m.cpp)}</td><td className="r">{fmtPct(m.l2p)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ═════════════════════════════════════ INFLUENCERS ═════════════════════════════════════

type InflTab = "season" | "platform" | "campaign" | "compare" | "list";

export function InfluencerPerformance({ sb, meta }: { sb: Client; meta: Meta }) {
  const [f, setF] = useState<Filters>({ from: yearAgo(), to: "", campaign: "", live: "live" });
  const [tab, setTab] = useState<InflTab>("season");
  const { rows, err } = usePerf(sb, "influencers", { from: f.from, to: f.to, campaign_ids: f.campaign ? [f.campaign] : null, live: f.live });
  const perCamp = !!f.campaign;
  return (
    <div className="mk-page">
      <div className="mk-head"><div><h2>Influencer Performance</h2><p>Season, platform, campaign and influencer-level numbers with attribution.</p></div></div>
      <FilterBar f={f} setF={setF} meta={meta} channel="influencers" />
      <Err msg={err} />
      <Tabs<InflTab> value={tab} onChange={setTab} tabs={[{ id: "season", label: "Season" }, { id: "platform", label: "Platform" }, { id: "campaign", label: "Campaign" }, { id: "compare", label: "Influencer Compare" }, { id: "list", label: "List" }]} />
      {tab === "campaign" ? <InflCampaigns sb={sb} meta={meta} f={f} /> : tab === "compare" ? <InflCompare sb={sb} meta={meta} f={f} /> : rows === null ? <p className="mk-mid">Loading…</p> : (
        <>
          {tab === "season" && <InflSeason rows={rows} perCamp={perCamp} />}
          {tab === "platform" && <InflPlatform rows={rows} perCamp={perCamp} />}
          {tab === "list" && <InflList rows={rows} />}
        </>
      )}
      <Note campaign={perCamp} />
    </div>
  );
}

function InflCards({ rows, perCamp, only }: { rows: PerfRow[]; perCamp: boolean; only?: "YouTube" | "Instagram" }) {
  const m = totals(rows, perCamp);
  const yt = rows.filter((r) => isYouTube(r.platform)), ig = rows.filter((r) => !isYouTube(r.platform));
  const views = (rs: PerfRow[]) => rs.reduce((a, r) => a + (Number(r.views) || 0), 0);
  return (
    <>
      <div className="mk-cards">
        <Card label="Influencers" value={fmtInt(new Set(rows.map((r) => r.influencer_id)).size)} />
        <Card label={only ? `${only} posts` : "Total posts"} value={fmtInt(rows.length)} />
        {!only && <Card label="YouTube posts" value={fmtInt(yt.length)} sub="by type in the table below" />}
        {!only && <Card label="Instagram posts" value={fmtInt(ig.length)} sub={`Reels ${ig.filter((r) => r.platform === "Instagram Reel").length} · Stories ${ig.filter((r) => r.platform === "Instagram Story").length}`} />}
        <Card label={only ? `${only} views` : "Total views"} value={fmtCompact(m.views)} />
        {!only && <Card label="YouTube views" value={fmtCompact(views(yt))} />}
        {!only && <Card label="Instagram views" value={fmtCompact(views(ig))} />}
      </div>
      <div className="mk-cards">
        <Card label="Leads" value={fmtInt(m.leads)} />
        <Card label="Payments" value={fmtInt(m.payments)} />
        <Card label="Enrollments" value={fmtInt(m.enrollments)} />
        <Card label="Cost" value={fmtInr(m.spend)} accent />
        <Card label="CPP" value={fmtInr(m.cpp)} sub="cost / payments" />
        <Card label="L2P" value={fmtPct(m.l2p, 2)} sub="leads → payments" />
        <Card label="V2L" value={fmtPct(m.v2l, 3)} sub="views → leads" />
      </div>
      <div className="mk-box"><h4>Attribution funnel</h4>
        <Funnel steps={[{ label: "Views", value: m.views }, { label: "Leads", value: m.leads }, { label: "Payments", value: m.payments }, { label: "Enrollments", value: m.enrollments }]} />
      </div>
    </>
  );
}

const postLabel = (b: NonNullable<Best>) => `${b.row.influencer ?? b.row.label} · ${b.row.platform}${b.row.live_date ? ` · ${fmtDate(b.row.live_date)}` : ""}`;

/** Every post type (YouTube Shorts / Dedicated / Integrated / Semi-Dedicated / Generic, Instagram Reel / Story), zeros included. */
function PostTypeTable({ rows, perCamp, types }: { rows: PerfRow[]; perCamp: boolean; types: readonly string[] }) {
  return (
    <div className="mk-box">
      <h4>By post type</h4>
      <div className="mk-tablewrap">
        <table className="mk-table">
          <thead><tr><th>Type</th><th className="r">Posts</th><th className="r">Views</th><th className="r">Cost</th><th className="r">Leads</th><th className="r">Payments</th><th className="r">Enrollments</th><th className="r">CPP</th><th className="r">L2P</th><th className="r">V2L</th></tr></thead>
          <tbody>
            {types.map((t) => {
              const rs = rows.filter((r) => r.platform === t);
              const m = totals(rs, perCamp);
              return (
                <tr key={t} style={rs.length ? undefined : { opacity: 0.5 }}>
                  <td className="mk-strong">{t}</td><td className="r">{fmtInt(rs.length)}</td><td className="r">{fmtCompact(m.views)}</td><td className="r">{fmtInr(m.spend)}</td>
                  <td className="r">{fmtInt(m.leads)}</td><td className="r">{fmtInt(m.payments)}</td><td className="r">{fmtInt(m.enrollments)}</td>
                  <td className="r">{fmtInr(m.cpp)}</td><td className="r">{fmtPct(m.l2p, 2)}</td><td className="r">{fmtPct(m.v2l, 3)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InflSeason({ rows, perCamp }: { rows: PerfRow[]; perCamp: boolean }) {
  return (
    <>
      <InflCards rows={rows} perCamp={perCamp} />
      <PostTypeTable rows={rows} perCamp={perCamp} types={INFL_PLATFORMS} />
    </>
  );
}

function InflPlatform({ rows, perCamp }: { rows: PerfRow[]; perCamp: boolean }) {
  const [p, setP] = useState<"YouTube" | "Instagram">("YouTube");
  const sub = rows.filter((r) => (p === "YouTube" ? isYouTube(r.platform) : !isYouTube(r.platform)));
  return (
    <>
      <div className="mk-bar">{(["YouTube", "Instagram"] as const).map((x) => <button key={x} className={x === p ? "mk-pri" : "mk-btn"} onClick={() => setP(x)}>{x}</button>)}</div>
      <InflCards rows={sub} perCamp={perCamp} only={p} />
      <h4 style={{ margin: "4px 0 0", fontFamily: "var(--display)", fontSize: 14 }}>Top performers · {p}</h4>
      <div className="mk-top">
        <TopCard title="Lowest CPP" best={lowestCpp(sub)} value={(b) => fmtInr(b.m.cpp)} who={postLabel} link={(b) => b.row.live_link} />
        <TopCard title={`Highest L2P (≥ ${MIN_LEADS} leads)`} best={highestL2p(sub)} value={(b) => fmtPct(b.m.l2p)} who={postLabel} link={(b) => b.row.live_link} />
        <TopCard title={`Best view → lead (≥ ${MIN_LEADS} leads)`} best={bestV2l(sub)} value={(b) => fmtPct(b.m.v2l, 3)} who={postLabel} link={(b) => b.row.live_link} />
      </div>
      <PostTypeTable rows={sub} perCamp={perCamp} types={INFL_PLATFORMS.filter((t) => (p === "YouTube") === isYouTube(t))} />
    </>
  );
}

function InflCampaigns({ sb, meta, f }: { sb: Client; meta: Meta; f: Filters }) {
  const [a, setA] = useState(meta.campaigns[meta.campaigns.length - 2]?.id ?? "");
  const [b, setB] = useState(meta.campaigns[meta.campaigns.length - 1]?.id ?? "");
  const ids = [a, b].filter(Boolean);
  const { rows, err } = usePerf(sb, "influencers", { from: "", to: "", campaign_ids: ids.length ? ids : null, live: f.live }, ids.length > 0);
  const col = (id: string) => {
    const c = meta.campaigns.find((x) => x.id === id);
    const rs = (rows ?? []).filter((r) => r.campaign_id === id);
    return { c, rs, m: totals(rs, true) };
  };
  const A = col(a), B = col(b);
  const line = (label: string, f2: (x: { c?: Campaign; rs: PerfRow[]; m: Metrics }) => string) => (
    <tr key={label}><td>{label}</td><td className="v">{a ? f2(A) : "—"}</td><td className="v">{b ? f2(B) : "—"}</td></tr>
  );
  return (
    <div className="mk-box">
      <div className="mk-bar" style={{ marginBottom: 12 }}>
        <select className="mk-sel" value={a} onChange={(e) => setA(e.target.value)} aria-label="Campaign A"><option value="">Pick a campaign</option>{meta.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <span className="mk-note">vs</span>
        <select className="mk-sel" value={b} onChange={(e) => setB(e.target.value)} aria-label="Campaign B"><option value="">Pick a campaign</option>{meta.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      </div>
      <Err msg={err} />
      {ids.length === 0 ? <p className="mk-mid">Add campaigns first (Influencer Listing → Campaigns), then pick two here.</p> : rows === null ? <p className="mk-mid">Loading…</p> : (
        <table className="mk-table mk-cmp">
          <thead><tr><th /><th className="r">{A.c?.name ?? "—"}</th><th className="r">{B.c?.name ?? "—"}</th></tr></thead>
          <tbody>
            {line("Window", (x) => (x.c ? `${fmtDate(x.c.campaign_start)} – ${fmtDate(x.c.campaign_end)}` : "—"))}
            {line("Budget", (x) => fmtInr(x.c?.budget))}
            {line("Spend", (x) => fmtInr(x.m.spend))}
            {line("Budget used", (x) => fmtPct(x.c?.budget ? (x.m.spend / x.c.budget) * 100 : null, 0))}
            {line("Application target", (x) => fmtInt(x.c?.application_target))}
            {line("Payments vs target", (x) => (x.c?.application_target ? `${fmtInt(x.m.payments)} / ${fmtInt(x.c.application_target)} (${fmtPct((x.m.payments / x.c.application_target) * 100, 0)})` : fmtInt(x.m.payments)))}
            {line("Posts", (x) => fmtInt(x.rs.length))}
            {line("Influencers", (x) => fmtInt(new Set(x.rs.map((r) => r.influencer_id)).size))}
            {line("Views", (x) => fmtCompact(x.m.views))}
            {line("Leads", (x) => fmtInt(x.m.leads))}
            {line("Payments", (x) => fmtInt(x.m.payments))}
            {line("Enrollments", (x) => fmtInt(x.m.enrollments))}
            {line("CPL", (x) => fmtInr(x.m.cpl))}
            {line("CPP", (x) => fmtInr(x.m.cpp))}
            {line("L2P", (x) => fmtPct(x.m.l2p, 2))}
            {line("V2L", (x) => fmtPct(x.m.v2l, 3))}
          </tbody>
        </table>
      )}
      <p className="mk-note" style={{ marginTop: 10 }}>Each campaign counts the leads that arrived inside its own dates.</p>
    </div>
  );
}

/** One side of the influencer compare: an influencer, optionally inside one campaign (so one influencer can be compared across two VSATs). */
function useSide(sb: Client, f: Filters, infl: string, camp: string) {
  const { rows, err } = usePerf(sb, "influencers", { from: camp ? "" : f.from, to: camp ? "" : f.to, campaign_ids: camp ? [camp] : null, live: f.live }, !!infl);
  const mine = useMemo(() => (rows ?? []).filter((r) => r.influencer_id === infl), [rows, infl]);
  const [weeks, setWeeks] = useState<Week[]>([]);
  const [wErr, setWErr] = useState("");
  const ids = mine.map((r) => r.id).join(",");
  useEffect(() => {
    if (!infl || !ids) { setWeeks([]); return; }
    let on = true;
    void rpc<{ weeks: Week[] }>(sb, "growth_weekly", { channel: "influencers", ids: ids.split(","), campaign_id: camp || null }).then((r) => {
      if (!on) return;
      if (r.error) setWErr(r.error); else { setWErr(""); setWeeks(r.data?.weeks ?? []); }
    });
    return () => { on = false; };
  }, [sb, infl, camp, ids]);
  return { rows: mine, loading: !!infl && rows === null, err: err || wErr, weeks, m: totals(mine, !!camp) };
}

function InflCompare({ sb, meta, f }: { sb: Client; meta: Meta; f: Filters }) {
  const [ai, setAi] = useState(""); const [ac, setAc] = useState("");
  const [bi, setBi] = useState(""); const [bc, setBc] = useState("");
  const A = useSide(sb, f, ai, ac), B = useSide(sb, f, bi, bc);
  const name = (i: string, c: string) => `${meta.influencers.find((x) => x.id === i)?.name ?? "—"}${c ? ` · ${meta.campaigns.find((x) => x.id === c)?.name ?? ""}` : ""}`;
  const picker = (i: string, setI: (v: string) => void, c: string, setC: (v: string) => void, tone: "a" | "b", label: string) => (
    <div className={`mk-box mk-box-${tone}`}>
      <h4>{label}</h4>
      <div className="mk-bar">
        <select className="mk-sel" value={i} onChange={(e) => setI(e.target.value)} aria-label={`${label} influencer`}><option value="">Pick an influencer</option>{meta.influencers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <select className="mk-sel" value={c} onChange={(e) => setC(e.target.value)} aria-label={`${label} campaign`}><option value="">All campaigns (date filter)</option>{meta.campaigns.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
      </div>
    </div>
  );
  const ready = !!(ai && bi);
  const line = (label: string, fn: (m: Metrics, n: number) => string) => (
    <tr key={label}><td>{label}</td><td className="v">{fn(A.m, A.rows.length)}</td><td className="v">{fn(B.m, B.rows.length)}</td></tr>
  );
  // the weekly charts span both sides' weeks so the two lines line up
  const span = (w: Week[]) => w.map((x) => x.week).sort();
  const allWeeks = [...span(A.weeks), ...span(B.weeks)].sort();
  const from = allWeeks[0], to = allWeeks[allWeeks.length - 1];
  return (
    <>
      <p className="mk-note">Pick an influencer on each side. Pick the same influencer with two different campaigns to see how they did in two VSATs.</p>
      <div className="mk-grid2">{picker(ai, setAi, ac, setAc, "a", "Influencer A")}{picker(bi, setBi, bc, setBc, "b", "Influencer B")}</div>
      <Err msg={A.err || B.err} />
      {!ready ? <p className="mk-mid">Pick both sides to compare.</p> : (A.loading || B.loading) ? <p className="mk-mid">Loading…</p> : (
        <>
          <div className="mk-box">
            <table className="mk-table mk-cmp">
              <thead><tr><th /><th className="r">A · {name(ai, ac)}</th><th className="r">B · {name(bi, bc)}</th></tr></thead>
              <tbody>
                {line("Posts", (_m, n) => fmtInt(n))}{line("Cost", (m) => fmtInr(m.spend))}{line("Views", (m) => fmtCompact(m.views))}
                {line("Leads", (m) => fmtInt(m.leads))}{line("Payments", (m) => fmtInt(m.payments))}{line("Enrollments", (m) => fmtInt(m.enrollments))}
                {line("CPL", (m) => fmtInr(m.cpl))}{line("CPP", (m) => fmtInr(m.cpp))}{line("L2P", (m) => fmtPct(m.l2p, 2))}{line("V2L", (m) => fmtPct(m.v2l, 3))}
              </tbody>
            </table>
          </div>
          <div className="mk-box"><h4>Weekly activity</h4>
            <WeeklyCompare a={fillWeeks(A.weeks, from, to)} b={fillWeeks(B.weeks, from, to)} labels={[`A · ${name(ai, ac)}`, `B · ${name(bi, bc)}`]} />
          </div>
        </>
      )}
    </>
  );
}

type ListKey = "influencer" | "platform" | "live_date" | "campaign" | "cost" | "views" | "leads" | "payments" | "enrollments" | "cpp" | "l2p" | "v2l";
function InflList({ rows }: { rows: PerfRow[] }) {
  const [sort, setSort] = useState<{ k: ListKey; dir: 1 | -1 }>({ k: "cpp", dir: 1 });
  const list = useMemo(() => {
    const withM = rows.map((r) => ({ r, m: metrics(Number(r.cost) || 0, r.leads, r.payments, r.enrollments, Number(r.views) || 0) }));
    const get = (x: { r: PerfRow; m: Metrics }): string | number | null => {
      switch (sort.k) {
        case "cost": return x.m.spend; case "views": return x.r.views; case "leads": return x.m.leads; case "payments": return x.m.payments;
        case "enrollments": return x.m.enrollments; case "cpp": return x.m.cpp; case "l2p": return x.m.l2p; case "v2l": return x.m.v2l;
        case "influencer": return x.r.influencer; case "platform": return x.r.platform; case "live_date": return x.r.live_date; case "campaign": return x.r.campaign;
      }
    };
    return withM.sort((x, y) => {
      const a = get(x), b = get(y);
      if (a === null && b === null) return 0;
      if (a === null) return 1;
      if (b === null) return -1;
      return (typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b))) * sort.dir;
    });
  }, [rows, sort]);
  const th = (k: ListKey, label: string, right = false) => (
    <th className={`mk-sort${right ? " r" : ""}`} onClick={() => setSort(sort.k === k ? { k, dir: sort.dir === 1 ? -1 : 1 } : { k, dir: k === "cpp" ? 1 : -1 })}>
      {label}{sort.k === k ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
    </th>
  );
  return (
    <div className="mk-tablewrap">
      <table className="mk-table">
        <thead><tr>{th("influencer", "Influencer")}{th("platform", "Platform")}{th("live_date", "Live date")}{th("campaign", "Campaign")}{th("cost", "Cost", true)}{th("views", "Views", true)}{th("leads", "Leads", true)}{th("payments", "Paid", true)}{th("enrollments", "Enrol", true)}{th("cpp", "CPP", true)}{th("l2p", "L2P %", true)}{th("v2l", "V2L %", true)}</tr></thead>
        <tbody>
          {list.length === 0 && <tr><td colSpan={12} className="mk-mid">No posts for these filters.</td></tr>}
          {list.map(({ r, m }) => (
            <tr key={r.id}>
              <td className="mk-strong"><ExtLink href={r.live_link}>{r.influencer ?? r.label}</ExtLink></td><td>{r.platform}</td><td>{fmtDate(r.live_date)}</td><td>{r.campaign ?? "—"}</td>
              <td className="r">{fmtInr(m.spend)}</td><td className="r">{fmtInt(r.views)}</td><td className="r">{fmtInt(m.leads)}</td><td className="r">{fmtInt(m.payments)}</td>
              <td className="r">{fmtInt(m.enrollments)}</td><td className="r">{fmtInr(m.cpp)}</td><td className="r">{fmtPct(m.l2p, 2)}</td><td className="r">{fmtPct(m.v2l, 3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

