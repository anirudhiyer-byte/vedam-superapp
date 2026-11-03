"use client";
import { Fragment, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Row = { id: string; name: string; channel: string; kind: string; product: string | null; audience_desc: string | null; recipient_count: number; created_at: string; status: string; sent: number; delivered: number; opened: number; clicked: number; bounced: number; failed: number; cost: number; delivery_pct: number | null; open_pct: number | null; click_pct: number | null; bounce_pct: number | null };
type Summary = { campaigns: number; total_recipients: number; total_sent: number; total_delivered: number; total_opened: number; total_clicked: number; total_bounced: number; total_failed: number; total_cost: number; avg_delivery_pct: number | null; avg_open_pct: number | null; avg_click_pct: number | null; avg_bounce_pct: number | null };
type Recipient = { channel: string; contact: string; status: string; sent_at: string | null; delivered_at: string | null; opened_at: string | null; clicked_at: string | null; failed: boolean; detail: string | null };

const PRODUCTS = ["", "bootcamp", "codesprint", "vsat", "global"];
const CHANNELS = ["", "email", "whatsapp"];
const KINDS = ["", "campaign", "reminder", "automation"];

// ── "Neural Glass" design system (shared with the Growth dashboards) ──────────
const P = { panel: "rgba(20,26,54,0.55)", brd: "rgba(130,150,255,0.14)", ink: "#f2f5ff", mut: "#aeb8e0", mut2: "#7681b2", line: "rgba(130,150,255,0.10)", menu: "#141a38" };
const DISPLAY = "var(--font-outfit), system-ui, sans-serif";
const MONO = "var(--font-jetbrains), ui-monospace, monospace";
type Variant = { bar: string; num: string; glow: string };
const V: Record<string, Variant> = {
  violet: { bar: "linear-gradient(90deg,#8b5cf6,#c4b5fd)", num: "#a78bfa", glow: "rgba(139,92,246,.45)" },
  cyan: { bar: "linear-gradient(90deg,#22d3ee,#a5f3fc)", num: "#22d3ee", glow: "rgba(34,211,238,.4)" },
  green: { bar: "linear-gradient(90deg,#34e2b0,#9af7df)", num: "#34e2b0", glow: "rgba(52,226,176,.4)" },
  blue: { bar: "linear-gradient(90deg,#5b8cff,#a9c2ff)", num: "#5b8cff", glow: "rgba(91,140,255,.4)" },
  amber: { bar: "linear-gradient(90deg,#ffb13d,#ffd89b)", num: "#ffb13d", glow: "rgba(255,177,61,.4)" },
  pink: { bar: "linear-gradient(90deg,#ff3d9a,#ffa6d4)", num: "#ff3d9a", glow: "rgba(255,61,154,.4)" },
};

const ICON = {
  campaigns: '<rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/>',
  sent: '<path d="M22 3L2 11l6 2 2 6 4-5 5 4z"/>',
  delivered: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>',
  opened: '<path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M3 9.5l9 6 9-6"/>',
  clicked: '<path d="M7 4l10 7-4.2 1.3L15 18l-2.4 1-2.2-5.6L7 16z"/>',
  bounced: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
  spend: '<rect x="2.5" y="6" width="19" height="13" rx="2.5"/><path d="M2.5 10.5h19"/>',
};
function Ico({ d, size = 16 }: { d: string; size?: number }) {
  return <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: d }} />;
}

/** Count-up roll (ease-out cubic, 1.3s) — same effect as the Growth dashboards. */
function Count({ to, money }: { to: number; money?: boolean }) {
  const [v, setV] = useState(to);
  useEffect(() => {
    if (typeof window === "undefined" || !isFinite(to)) { setV(to); return; }
    if (window.matchMedia?.("(prefers-reduced-motion:reduce)")?.matches) { setV(to); return; }
    let raf = 0; const t0 = performance.now(), d = 1300;
    const tick = (t: number) => { const k = Math.min((t - t0) / d, 1); const e = 1 - Math.pow(1 - k, 3); setV(to * e); if (k < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <>{money ? `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : Math.round(v).toLocaleString("en-IN")}</>;
}

export function CampaignReport() {
  const [supabase] = useState(() => createClient());
  const [rows, setRows] = useState<Row[]>([]);
  const [sum, setSum] = useState<Summary | null>(null);
  const [product, setProduct] = useState(""); const [channel, setChannel] = useState(""); const [kind, setKind] = useState("");
  const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [month, setMonth] = useState("");
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [recips, setRecips] = useState<Record<string, Recipient[]>>({});
  const [recipLoading, setRecipLoading] = useState<string | null>(null);

  const toggleRow = async (id: string) => {
    const next = open === id ? null : id;
    setOpen(next);
    if (next && !recips[id]) {
      setRecipLoading(id);
      const { data } = await supabase.rpc("campaign_recipients", { p_campaign: id });
      setRecips((m) => ({ ...m, [id]: (data as Recipient[]) ?? [] }));
      setRecipLoading(null);
    }
  };

  // highest status reached, for a compact per-recipient chip
  const statusOf = (r: Recipient) => r.failed ? { label: "Failed", color: "#ff3d9a" }
    : r.clicked_at ? { label: "Clicked", color: "#a78bfa" }
    : r.opened_at ? { label: "Opened", color: "#34e2b0" }
    : r.delivered_at ? { label: "Delivered", color: "#22d3ee" }
    : { label: "Sent", color: P.mut2 };

  const range = useMemo(() => {
    if (month) { const [y, m] = month.split("-").map(Number); const f = new Date(y, m - 1, 1); const t = new Date(y, m, 1); return { p_from: f.toISOString(), p_to: t.toISOString() }; }
    return { p_from: from ? new Date(from).toISOString() : null, p_to: to ? new Date(to + "T23:59:59").toISOString() : null };
  }, [month, from, to]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const args = { p_product: product || null, p_channel: channel || null, p_kind: kind || null, ...range };
      const [{ data: r }, { data: s }] = await Promise.all([
        supabase.rpc("campaign_report_filtered", args),
        supabase.rpc("campaign_summary", args),
      ]);
      setRows((r as Row[]) ?? []); setSum((s as Summary) ?? null); setLoading(false);
    })();
  }, [supabase, product, channel, kind, range]);

  const pct = (v: number | null) => v == null ? "—" : `${v}%`;
  const dirty = Boolean(product || channel || kind || from || to || month);
  const panelStyle = { background: P.panel, borderColor: P.brd, backdropFilter: "blur(16px)" as const };
  const fieldStyle = { background: "rgba(11,16,36,0.6)", borderColor: P.brd, color: P.ink, fontFamily: "var(--font-inter)" };
  const field = "rounded-[13px] border px-3.5 py-2.5 text-[13.5px] outline-none [color-scheme:dark]";
  const lbl = "text-[11px] font-medium uppercase tracking-[1.3px]";

  const cards: { label: string; to: number; money?: boolean; sub?: string; icon: string; v: Variant }[] = sum ? [
    { label: "Campaigns", to: sum.campaigns, sub: `${sum.total_recipients} recipients`, icon: ICON.campaigns, v: V.violet },
    { label: "Sent", to: sum.total_sent, sub: "messages pushed", icon: ICON.sent, v: V.cyan },
    { label: "Delivered", to: sum.total_delivered, sub: `${pct(sum.avg_delivery_pct)} delivery rate`, icon: ICON.delivered, v: V.green },
    { label: "Opened", to: sum.total_opened, sub: `${pct(sum.avg_open_pct)} open rate`, icon: ICON.opened, v: V.blue },
    { label: "Clicked", to: sum.total_clicked, sub: `${pct(sum.avg_click_pct)} click rate`, icon: ICON.clicked, v: V.violet },
    { label: "Bounced", to: sum.total_bounced, sub: `${pct(sum.avg_bounce_pct)} bounce rate`, icon: ICON.bounced, v: V.amber },
    { label: "Spend", to: Number(sum.total_cost), money: true, sub: "all channels", icon: ICON.spend, v: V.pink },
  ] : [];

  const th = "whitespace-nowrap px-3 py-3 text-left text-[10px] font-semibold uppercase tracking-[1.2px]";

  return (
    <div className="relative" style={{ fontFamily: "var(--font-inter)", color: P.ink }}>
      {/* static ambient glow (no animation) */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10" style={{ background: "radial-gradient(620px 360px at 85% -10%, rgba(139,92,246,.12), transparent 60%), radial-gradient(520px 340px at -5% 110%, rgba(34,211,238,.08), transparent 60%)" }} />

      <div className="space-y-5">
        {/* filters */}
        <div className="rounded-[18px] border p-4" style={panelStyle}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className={lbl} style={{ color: P.mut2, fontFamily: MONO }}>Filters</span>
            {dirty && <button onClick={() => { setProduct(""); setChannel(""); setKind(""); setFrom(""); setTo(""); setMonth(""); }} className="rounded-[10px] border px-2.5 py-1 text-[11px] font-semibold" style={{ borderColor: P.brd, color: "#a78bfa" }}>Clear all</button>}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            {[
              { l: "Product", val: product, set: setProduct, opts: PRODUCTS, all: "All products" },
              { l: "Channel", val: channel, set: setChannel, opts: CHANNELS, all: "All channels" },
              { l: "Type", val: kind, set: setKind, opts: KINDS, all: "All types" },
            ].map((f) => (
              <label key={f.l} className="flex flex-col gap-1.5">
                <span className={lbl} style={{ color: P.mut2, fontFamily: MONO }}>{f.l}</span>
                <select value={f.val} onChange={(e) => f.set(e.target.value)} className={field} style={fieldStyle}>
                  {f.opts.map((o) => <option key={o} value={o} style={{ background: P.menu }}>{o || f.all}</option>)}
                </select>
              </label>
            ))}
            <label className="flex flex-col gap-1.5"><span className={lbl} style={{ color: P.mut2, fontFamily: MONO }}>Month</span><input type="month" value={month} onChange={(e) => { setMonth(e.target.value); setFrom(""); setTo(""); }} className={field} style={fieldStyle} /></label>
            <label className="flex flex-col gap-1.5"><span className={lbl} style={{ color: P.mut2, fontFamily: MONO }}>From</span><input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setMonth(""); }} className={field} style={fieldStyle} /></label>
            <label className="flex flex-col gap-1.5"><span className={lbl} style={{ color: P.mut2, fontFamily: MONO }}>To</span><input type="date" value={to} onChange={(e) => { setTo(e.target.value); setMonth(""); }} className={field} style={fieldStyle} /></label>
          </div>
        </div>

        {/* summary cards */}
        {sum && (
          <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
            {cards.map((c) => (
              <div key={c.label} className="relative overflow-hidden rounded-[18px] border px-5 pb-5 pt-[18px]" style={panelStyle}>
                <div className="absolute inset-x-0 top-0 h-[2px]" style={{ background: c.v.bar }} />
                <div className="flex items-center justify-between" style={{ color: P.mut }}>
                  <span className="text-[12px] font-medium uppercase tracking-[1.5px]" style={{ fontFamily: MONO }}>{c.label}</span>
                  <span className="opacity-80"><Ico d={c.icon} /></span>
                </div>
                <div className="mt-3 text-[30px] font-bold leading-none tracking-tight tabular-nums" style={{ fontFamily: DISPLAY, color: c.v.num, textShadow: `0 0 22px ${c.v.glow}` }}><Count to={c.to} money={c.money} /></div>
                {c.sub && <div className="mt-[11px] text-[11.5px] leading-snug" style={{ color: P.mut2 }}>{c.sub}</div>}
              </div>
            ))}
          </div>
        )}

        {/* table */}
        <div className="overflow-hidden rounded-[18px] border" style={panelStyle}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead style={{ color: P.mut2, fontFamily: MONO, borderBottom: `1px solid ${P.line}` }}>
                <tr>{["Campaign", "Channel", "Product", "Type", "When", "Sent", "Deliv %", "Open %", "Click %", "Bounce %", "Cost"].map((h) => <th key={h} className={th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {loading ? <tr><td colSpan={11} className="px-3 py-16 text-center" style={{ color: P.mut2 }}>Loading…</td></tr>
                : rows.length === 0 ? <tr><td colSpan={11} className="px-3 py-16 text-center" style={{ color: P.mut2 }}>No campaigns match these filters.</td></tr>
                : rows.map((r) => {
                  const on = open === r.id;
                  return (
                  <Fragment key={r.id}>
                  <tr onClick={() => toggleRow(r.id)} className="cursor-pointer" style={{ borderTop: `1px solid ${P.line}`, background: on ? "rgba(139,92,246,.10)" : "transparent" }}>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2 font-semibold" style={{ color: P.ink }}>
                        <span style={{ color: P.mut2 }}>{on ? "▾" : "▸"}</span>{r.name}
                      </div>
                      {on && r.audience_desc && <div className="mt-1 pl-5 text-[10px]" style={{ color: P.mut2, fontFamily: MONO }}>{r.audience_desc}</div>}
                    </td>
                    <td className="px-3 py-3">
                      <span className="inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold" style={r.channel === "whatsapp" ? { background: "rgba(52,226,176,.12)", color: "#34e2b0" } : { background: "rgba(91,140,255,.12)", color: "#5b8cff" }}>
                        {r.channel === "whatsapp" ? "WhatsApp" : "Email"}
                      </span>
                    </td>
                    <td className="px-3 py-3 capitalize" style={{ color: P.mut }}>{r.product || "—"}</td>
                    <td className="px-3 py-3 capitalize" style={{ color: P.mut }}>{r.kind}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-xs" style={{ color: P.mut2, fontFamily: MONO }}>{new Date(r.created_at).toLocaleDateString()}</td>
                    <td className="px-3 py-3 tabular-nums" style={{ color: P.ink }}>{r.sent}<span style={{ color: P.mut2 }}> / {r.recipient_count}</span></td>
                    <td className="px-3 py-3 tabular-nums" style={{ color: r.delivery_pct ? "#34e2b0" : P.mut2 }}>{pct(r.delivery_pct)}</td>
                    <td className="px-3 py-3 tabular-nums" style={{ color: r.open_pct ? "#5b8cff" : P.mut2 }}>{pct(r.open_pct)}</td>
                    <td className="px-3 py-3 tabular-nums" style={{ color: r.click_pct ? "#a78bfa" : P.mut2 }}>{pct(r.click_pct)}</td>
                    <td className="px-3 py-3 tabular-nums" style={{ color: r.bounce_pct ? "#ffb13d" : P.mut2 }}>{pct(r.bounce_pct)}</td>
                    <td className="whitespace-nowrap px-3 py-3 text-xs tabular-nums" style={{ color: P.ink, fontFamily: MONO }}>₹{Number(r.cost).toFixed(2)}</td>
                  </tr>
                  {on && (
                    <tr style={{ borderTop: `1px solid ${P.line}`, background: "rgba(7,10,22,.5)" }}>
                      <td colSpan={11} className="px-3 py-3">
                        {recipLoading === r.id ? <div className="py-4 text-center text-xs" style={{ color: P.mut2 }}>Loading recipients…</div>
                        : (recips[r.id] ?? []).length === 0 ? <div className="py-4 text-center text-xs" style={{ color: P.mut2 }}>No recipient records yet for this campaign.</div>
                        : (
                          <div className="max-h-72 overflow-auto rounded-[14px] border" style={{ borderColor: P.brd }}>
                            <table className="w-full text-xs">
                              <thead className="sticky top-0" style={{ background: P.menu, color: P.mut2, fontFamily: MONO }}>
                                <tr>{["Recipient", "Status", "Sent", "Delivered", "Opened", "Clicked"].map((h) => <th key={h} className={th}>{h}</th>)}</tr>
                              </thead>
                              <tbody>
                                {(recips[r.id] ?? []).map((p, i) => {
                                  const s = statusOf(p);
                                  const t = (v: string | null) => v ? new Date(v).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
                                  return (
                                    <tr key={p.contact + i} style={{ borderTop: `1px solid ${P.line}` }}>
                                      <td className="px-3 py-2 text-[11px]" style={{ color: P.ink, fontFamily: MONO }}>{p.contact}</td>
                                      <td className="px-3 py-2">
                                        <span className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: s.color + "22", color: s.color }}>{s.label}</span>
                                        {p.failed && p.detail && <span className="ml-1.5 text-[10px]" style={{ color: P.mut2 }}>{p.detail}</span>}
                                      </td>
                                      <td className="whitespace-nowrap px-3 py-2" style={{ color: P.mut2 }}>{t(p.sent_at)}</td>
                                      <td className="whitespace-nowrap px-3 py-2" style={{ color: P.mut2 }}>{t(p.delivered_at)}</td>
                                      <td className="whitespace-nowrap px-3 py-2" style={{ color: P.mut2 }}>{p.channel === "whatsapp" ? "—" : t(p.opened_at)}</td>
                                      <td className="whitespace-nowrap px-3 py-2" style={{ color: P.mut2 }}>{p.channel === "whatsapp" ? "—" : t(p.clicked_at)}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ); })}
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-[11px]" style={{ color: P.mut2, fontFamily: MONO }}>Click a campaign to see who it went to · WhatsApp has no open/click tracking</p>
      </div>
    </div>
  );
}
