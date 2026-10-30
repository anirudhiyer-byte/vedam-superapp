"use client";
import { Fragment, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Row = { id: string; name: string; channel: string; kind: string; product: string | null; audience_desc: string | null; recipient_count: number; created_at: string; status: string; sent: number; delivered: number; opened: number; clicked: number; bounced: number; failed: number; cost: number; delivery_pct: number | null; open_pct: number | null; click_pct: number | null; bounce_pct: number | null };
type Summary = { campaigns: number; total_recipients: number; total_sent: number; total_delivered: number; total_opened: number; total_clicked: number; total_bounced: number; total_failed: number; total_cost: number; avg_delivery_pct: number | null; avg_open_pct: number | null; avg_click_pct: number | null; avg_bounce_pct: number | null };
type Recipient = { channel: string; contact: string; status: string; sent_at: string | null; delivered_at: string | null; opened_at: string | null; clicked_at: string | null; failed: boolean; detail: string | null };

const PRODUCTS = ["", "bootcamp", "codesprint", "vsat", "global"];
const CHANNELS = ["", "email", "whatsapp"];
const KINDS = ["", "campaign", "reminder", "automation"];

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
  const statusOf = (r: Recipient) => r.failed ? { label: "Failed", cls: "text-red-500" }
    : r.clicked_at ? { label: "Clicked", cls: "text-emerald-600" }
    : r.opened_at ? { label: "Opened", cls: "text-emerald-500" }
    : r.delivered_at ? { label: "Delivered", cls: "text-sky-500" }
    : { label: "Sent", cls: "text-muted" };

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

  const sel = "rounded-lg border border-border-strong bg-background px-2.5 py-1.5 text-sm text-foreground outline-none [color-scheme:dark]";
  const pct = (v: number | null) => v == null ? "—" : `${v}%`;

  return (
    <div className="space-y-4">
      {/* filters */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-[11px] font-semibold text-muted">Product<select value={product} onChange={(e) => setProduct(e.target.value)} className={sel + " mt-1"}>{PRODUCTS.map((p) => <option key={p} value={p}>{p || "All products"}</option>)}</select></label>
        <label className="flex flex-col text-[11px] font-semibold text-muted">Channel<select value={channel} onChange={(e) => setChannel(e.target.value)} className={sel + " mt-1"}>{CHANNELS.map((c) => <option key={c} value={c}>{c || "All channels"}</option>)}</select></label>
        <label className="flex flex-col text-[11px] font-semibold text-muted">Type<select value={kind} onChange={(e) => setKind(e.target.value)} className={sel + " mt-1"}>{KINDS.map((k) => <option key={k} value={k}>{k || "All types"}</option>)}</select></label>
        <label className="flex flex-col text-[11px] font-semibold text-muted">Month<input type="month" value={month} onChange={(e) => { setMonth(e.target.value); setFrom(""); setTo(""); }} className={sel + " mt-1"} /></label>
        <label className="flex flex-col text-[11px] font-semibold text-muted">From<input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setMonth(""); }} className={sel + " mt-1"} /></label>
        <label className="flex flex-col text-[11px] font-semibold text-muted">To<input type="date" value={to} onChange={(e) => { setTo(e.target.value); setMonth(""); }} className={sel + " mt-1"} /></label>
        {(product || channel || kind || from || to || month) && <button onClick={() => { setProduct(""); setChannel(""); setKind(""); setFrom(""); setTo(""); setMonth(""); }} className="text-xs font-semibold text-accent">clear</button>}
      </div>

      {/* summary cards */}
      {sum && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {[["Campaigns", sum.campaigns], ["Sent", sum.total_sent], ["Delivered", `${sum.total_delivered} · ${pct(sum.avg_delivery_pct)}`], ["Opened", `${sum.total_opened} · ${pct(sum.avg_open_pct)}`], ["Clicked", `${sum.total_clicked} · ${pct(sum.avg_click_pct)}`], ["Bounced", `${sum.total_bounced} · ${pct(sum.avg_bounce_pct)}`], ["Spend", `₹${Number(sum.total_cost).toFixed(2)}`]].map(([l, v]) => (
            <div key={l as string} className="rounded-xl border border-border bg-surface p-3"><div className="font-mono text-[10px] uppercase tracking-wide text-muted">{l}</div><div className="mt-0.5 font-display text-sm font-bold text-heading">{v}</div></div>
          ))}
        </div>
      )}

      {/* table */}
      <div className="overflow-x-auto rounded-2xl border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface text-muted"><tr>{["Campaign", "Channel", "Product", "Type", "When", "Sent", "Deliv %", "Open %", "Click %", "Bounce %", "Cost"].map((h) => <th key={h} className="whitespace-nowrap p-3 font-semibold">{h}</th>)}</tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={11} className="p-6 text-center text-muted">Loading…</td></tr>
            : rows.length === 0 ? <tr><td colSpan={11} className="p-6 text-center text-muted">No campaigns match these filters.</td></tr>
            : rows.map((r) => (
              <Fragment key={r.id}>
              <tr className="cursor-pointer border-t border-border hover:bg-surface-warm/40" onClick={() => toggleRow(r.id)}>
                <td className="p-3"><div className="flex items-center gap-1.5 font-semibold text-heading"><span className={"inline-block transition-transform " + (open === r.id ? "rotate-90" : "")}>›</span>{r.name}</div>{open === r.id && r.audience_desc && <div className="mt-0.5 font-mono text-[10px] text-muted">{r.audience_desc}</div>}</td>
                <td className="p-3 capitalize text-muted">{r.channel === "whatsapp" ? "WhatsApp" : "Email"}</td>
                <td className="p-3 capitalize text-muted">{r.product || "—"}</td>
                <td className="p-3 capitalize text-muted">{r.kind}</td>
                <td className="whitespace-nowrap p-3 font-mono text-xs text-muted">{new Date(r.created_at).toLocaleDateString()}</td>
                <td className="p-3">{r.sent}<span className="text-muted"> / {r.recipient_count}</span></td>
                <td className="p-3">{pct(r.delivery_pct)}</td>
                <td className="p-3">{pct(r.open_pct)}</td>
                <td className="p-3">{pct(r.click_pct)}</td>
                <td className="p-3">{pct(r.bounce_pct)}</td>
                <td className="p-3">₹{Number(r.cost).toFixed(2)}</td>
              </tr>
              {open === r.id && (
                <tr className="border-t border-border bg-surface-warm/20">
                  <td colSpan={11} className="p-3">
                    {recipLoading === r.id ? <div className="py-3 text-center text-xs text-muted">Loading recipients…</div>
                    : (recips[r.id] ?? []).length === 0 ? <div className="py-3 text-center text-xs text-muted">No recipient records yet for this campaign.</div>
                    : (
                      <div className="max-h-72 overflow-auto rounded-lg border border-border">
                        <table className="w-full text-left text-xs">
                          <thead className="sticky top-0 bg-surface text-muted"><tr>{["Recipient", "Status", "Sent", "Delivered", "Opened", "Clicked"].map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 font-semibold">{h}</th>)}</tr></thead>
                          <tbody>
                            {(recips[r.id] ?? []).map((p, i) => { const s = statusOf(p); const t = (v: string | null) => v ? new Date(v).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"; return (
                              <tr key={p.contact + i} className="border-t border-border">
                                <td className="px-3 py-1.5 font-mono text-[11px] text-heading">{p.contact}</td>
                                <td className={"px-3 py-1.5 font-semibold " + s.cls}>{s.label}{p.failed && p.detail ? ` · ${p.detail}` : ""}</td>
                                <td className="px-3 py-1.5 text-muted">{t(p.sent_at)}</td>
                                <td className="px-3 py-1.5 text-muted">{t(p.delivered_at)}</td>
                                <td className="px-3 py-1.5 text-muted">{p.channel === "whatsapp" ? "—" : t(p.opened_at)}</td>
                                <td className="px-3 py-1.5 text-muted">{p.channel === "whatsapp" ? "—" : t(p.clicked_at)}</td>
                              </tr>
                            ); })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
