"use client";
import { Fragment, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Row = { id: string; name: string; channel: string; kind: string; product: string | null; audience_desc: string | null; recipient_count: number; created_at: string; status: string; sent: number; delivered: number; opened: number; clicked: number; bounced: number; failed: number; cost: number; delivery_pct: number | null; open_pct: number | null; click_pct: number | null; bounce_pct: number | null };
type Summary = { campaigns: number; total_recipients: number; total_sent: number; total_delivered: number; total_opened: number; total_clicked: number; total_bounced: number; total_failed: number; total_cost: number; avg_delivery_pct: number | null; avg_open_pct: number | null; avg_click_pct: number | null; avg_bounce_pct: number | null };
type Recipient = { channel: string; contact: string; status: string; sent_at: string | null; delivered_at: string | null; opened_at: string | null; clicked_at: string | null; failed: boolean; detail: string | null };

const PRODUCTS = ["", "bootcamp", "codesprint", "vsat", "global"];
const CHANNELS = ["", "email", "whatsapp"];
const KINDS = ["", "campaign", "reminder", "automation"];

const ICON = {
  campaigns: '<rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/>',
  sent: '<path d="M22 3L2 11l6 2 2 6 4-5 5 4z"/>',
  delivered: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>',
  opened: '<path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M3 9.5l9 6 9-6"/>',
  clicked: '<path d="M7 4l10 7-4.2 1.3L15 18l-2.4 1-2.2-5.6L7 16z"/>',
  bounced: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',
  spend: '<rect x="2.5" y="6" width="19" height="13" rx="2.5"/><path d="M2.5 10.5h19"/>',
};

function Ico({ d }: { d: string }) {
  return <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: d }} />;
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
  const statusOf = (r: Recipient) => r.failed ? { label: "Failed", cls: "border-red-400/25 bg-red-400/10 text-red-300" }
    : r.clicked_at ? { label: "Clicked", cls: "border-violet-400/25 bg-violet-400/10 text-violet-300" }
    : r.opened_at ? { label: "Opened", cls: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300" }
    : r.delivered_at ? { label: "Delivered", cls: "border-sky-400/25 bg-sky-400/10 text-sky-300" }
    : { label: "Sent", cls: "border-white/15 bg-white/[0.06] text-white/60" };

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

  const sel = "rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2 text-sm text-white outline-none [color-scheme:dark] focus:border-[color:rgb(var(--accent))]";
  const lbl = "font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-white/45";
  const pct = (v: number | null) => v == null ? "—" : `${v}%`;
  const dirty = Boolean(product || channel || kind || from || to || month);

  const cards: { label: string; value: string | number; sub?: string; icon: string; tint: string }[] = sum ? [
    { label: "Campaigns", value: sum.campaigns, icon: ICON.campaigns, tint: "border-white/15 bg-white/[0.06] text-white/70" },
    { label: "Sent", value: sum.total_sent, sub: `${sum.total_recipients} targeted`, icon: ICON.sent, tint: "border-sky-400/25 bg-sky-400/10 text-sky-300" },
    { label: "Delivered", value: sum.total_delivered, sub: pct(sum.avg_delivery_pct), icon: ICON.delivered, tint: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300" },
    { label: "Opened", value: sum.total_opened, sub: pct(sum.avg_open_pct), icon: ICON.opened, tint: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300" },
    { label: "Clicked", value: sum.total_clicked, sub: pct(sum.avg_click_pct), icon: ICON.clicked, tint: "border-violet-400/25 bg-violet-400/10 text-violet-300" },
    { label: "Bounced", value: sum.total_bounced, sub: pct(sum.avg_bounce_pct), icon: ICON.bounced, tint: "border-amber-400/25 bg-amber-400/10 text-amber-300" },
    { label: "Spend", value: `₹${Number(sum.total_cost).toFixed(2)}`, sub: "all channels", icon: ICON.spend, tint: "border-[color:rgb(var(--accent))]/30 bg-[color:rgb(var(--accent))]/12 text-[color:rgb(var(--accent))]" },
  ] : [];

  return (
    <div className="space-y-5 font-[family-name:var(--font-inter)]">
      {/* filters */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className={lbl}>Filters</span>
          {dirty && <button onClick={() => { setProduct(""); setChannel(""); setKind(""); setFrom(""); setTo(""); setMonth(""); }} className="rounded-lg border border-white/15 px-2.5 py-1 text-[11px] font-semibold text-white/70 hover:border-white/30 hover:text-white">Clear all</button>}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1"><span className={lbl}>Product</span><select value={product} onChange={(e) => setProduct(e.target.value)} className={sel}>{PRODUCTS.map((p) => <option key={p} value={p}>{p || "All products"}</option>)}</select></label>
          <label className="flex flex-col gap-1"><span className={lbl}>Channel</span><select value={channel} onChange={(e) => setChannel(e.target.value)} className={sel}>{CHANNELS.map((c) => <option key={c} value={c}>{c || "All channels"}</option>)}</select></label>
          <label className="flex flex-col gap-1"><span className={lbl}>Type</span><select value={kind} onChange={(e) => setKind(e.target.value)} className={sel}>{KINDS.map((k) => <option key={k} value={k}>{k || "All types"}</option>)}</select></label>
          <label className="flex flex-col gap-1"><span className={lbl}>Month</span><input type="month" value={month} onChange={(e) => { setMonth(e.target.value); setFrom(""); setTo(""); }} className={sel} /></label>
          <label className="flex flex-col gap-1"><span className={lbl}>From</span><input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setMonth(""); }} className={sel} /></label>
          <label className="flex flex-col gap-1"><span className={lbl}>To</span><input type="date" value={to} onChange={(e) => { setTo(e.target.value); setMonth(""); }} className={sel} /></label>
        </div>
      </div>

      {/* summary cards */}
      {sum && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {cards.map((c) => (
            <div key={c.label} className="rounded-2xl border border-white/10 bg-white/[0.055] p-4">
              <div className="flex items-center gap-2">
                <span className={"grid h-7 w-7 shrink-0 place-items-center rounded-lg border " + c.tint}><Ico d={c.icon} /></span>
                <span className={lbl + " truncate"}>{c.label}</span>
              </div>
              <div className="mt-3 text-2xl font-extrabold tracking-tight text-white tabular-nums">{c.value}</div>
              {c.sub && <div className="mt-0.5 font-mono text-[11px] text-white/40">{c.sub}</div>}
            </div>
          ))}
        </div>
      )}

      {/* table */}
      <div className="overflow-hidden rounded-2xl border border-white/10">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-white/[0.05] text-white/50">
              <tr>{["Campaign", "Channel", "Product", "Type", "When", "Sent", "Deliv %", "Open %", "Click %", "Bounce %", "Cost"].map((h) => (
                <th key={h} className="whitespace-nowrap px-3 py-3 font-mono text-[10px] font-semibold uppercase tracking-[0.12em]">{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {loading ? <tr><td colSpan={11} className="px-3 py-14 text-center text-white/45">Loading…</td></tr>
              : rows.length === 0 ? <tr><td colSpan={11} className="px-3 py-14 text-center text-white/45">No campaigns match these filters.</td></tr>
              : rows.map((r) => {
                const on = open === r.id;
                return (
                <Fragment key={r.id}>
                <tr onClick={() => toggleRow(r.id)} className={["cursor-pointer border-t border-white/[0.06]", on ? "bg-[color:rgb(var(--accent))]/10" : "hover:bg-white/[0.035]"].join(" ")}>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2 font-semibold text-white">
                      <span className="text-white/40">{on ? "▾" : "▸"}</span>{r.name}
                    </div>
                    {on && r.audience_desc && <div className="mt-1 pl-5 font-mono text-[10px] text-white/40">{r.audience_desc}</div>}
                  </td>
                  <td className="px-3 py-3">
                    <span className={["inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold", r.channel === "whatsapp" ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300" : "border-sky-400/25 bg-sky-400/10 text-sky-300"].join(" ")}>
                      {r.channel === "whatsapp" ? "WhatsApp" : "Email"}
                    </span>
                  </td>
                  <td className="px-3 py-3 capitalize text-white/60">{r.product || "—"}</td>
                  <td className="px-3 py-3 capitalize text-white/60">{r.kind}</td>
                  <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-white/50">{new Date(r.created_at).toLocaleDateString()}</td>
                  <td className="px-3 py-3 tabular-nums text-white">{r.sent}<span className="text-white/35"> / {r.recipient_count}</span></td>
                  <td className={"px-3 py-3 tabular-nums " + (r.delivery_pct ? "text-emerald-300" : "text-white/45")}>{pct(r.delivery_pct)}</td>
                  <td className={"px-3 py-3 tabular-nums " + (r.open_pct ? "text-emerald-300" : "text-white/45")}>{pct(r.open_pct)}</td>
                  <td className={"px-3 py-3 tabular-nums " + (r.click_pct ? "text-violet-300" : "text-white/45")}>{pct(r.click_pct)}</td>
                  <td className={"px-3 py-3 tabular-nums " + (r.bounce_pct ? "text-amber-300" : "text-white/45")}>{pct(r.bounce_pct)}</td>
                  <td className="whitespace-nowrap px-3 py-3 font-mono text-xs tabular-nums text-white">₹{Number(r.cost).toFixed(2)}</td>
                </tr>
                {on && (
                  <tr className="border-t border-white/[0.06] bg-black/20">
                    <td colSpan={11} className="px-3 py-3">
                      {recipLoading === r.id ? <div className="py-4 text-center text-xs text-white/45">Loading recipients…</div>
                      : (recips[r.id] ?? []).length === 0 ? <div className="py-4 text-center text-xs text-white/45">No recipient records yet for this campaign.</div>
                      : (
                        <div className="max-h-72 overflow-auto rounded-xl border border-white/10">
                          <table className="w-full text-left text-xs">
                            <thead className="sticky top-0 bg-[#16161b] text-white/45">
                              <tr>{["Recipient", "Status", "Sent", "Delivered", "Opened", "Clicked"].map((h) => (
                                <th key={h} className="whitespace-nowrap px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em]">{h}</th>
                              ))}</tr>
                            </thead>
                            <tbody>
                              {(recips[r.id] ?? []).map((p, i) => {
                                const s = statusOf(p);
                                const t = (v: string | null) => v ? new Date(v).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
                                return (
                                  <tr key={p.contact + i} className="border-t border-white/[0.06]">
                                    <td className="px-3 py-2 font-mono text-[11px] text-white/85">{p.contact}</td>
                                    <td className="px-3 py-2">
                                      <span className={"inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold " + s.cls}>{s.label}</span>
                                      {p.failed && p.detail && <span className="ml-1.5 text-[10px] text-white/40">{p.detail}</span>}
                                    </td>
                                    <td className="whitespace-nowrap px-3 py-2 text-white/50">{t(p.sent_at)}</td>
                                    <td className="whitespace-nowrap px-3 py-2 text-white/50">{t(p.delivered_at)}</td>
                                    <td className="whitespace-nowrap px-3 py-2 text-white/50">{p.channel === "whatsapp" ? "—" : t(p.opened_at)}</td>
                                    <td className="whitespace-nowrap px-3 py-2 text-white/50">{p.channel === "whatsapp" ? "—" : t(p.clicked_at)}</td>
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

      <p className="font-mono text-[11px] text-white/35">Click a campaign to see who it went to · WhatsApp has no open/click tracking</p>
    </div>
  );
}
