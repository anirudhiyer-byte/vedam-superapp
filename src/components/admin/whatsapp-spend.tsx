"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Summary = { total_sends: number; total_sent: number; total_failed: number; total_cost: number; sends_24h: number; cost_24h: number; sends_7d: number; cost_7d: number };
type Day = { day: string; sends: number; cost: number };
const inr = (n: number) => "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function WhatsAppSpend() {
  const [supabase] = useState(() => createClient());
  const [s, setS] = useState<Summary | null>(null);
  const [days, setDays] = useState<Day[]>([]);

  useEffect(() => {
    (async () => {
      const { data: sum } = await supabase.rpc("wa_spend_summary");
      setS(Array.isArray(sum) ? (sum[0] as Summary) : (sum as Summary));
      const { data: d } = await supabase.rpc("wa_spend_daily");
      setDays((d as Day[]) ?? []);
    })();
  }, [supabase]);

  const Card = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="font-mono text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 font-display text-2xl font-extrabold text-heading">{value}</div>
      {sub && <div className="mt-0.5 font-mono text-xs text-muted">{sub}</div>}
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <span className="font-mono text-xs font-semibold lowercase tracking-[0.12em] text-accent">// whatsapp · spend</span>
      <h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight text-heading">WhatsApp spend</h1>
      <p className="mt-1 font-body text-sm text-muted">Messages sent and cost across the channel.</p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card label="Total spent" value={s ? inr(s.total_cost) : "…"} sub={s ? `${s.total_sends} messages` : ""} />
        <Card label="Last 24h" value={s ? inr(s.cost_24h) : "…"} sub={s ? `${s.sends_24h} sent` : ""} />
        <Card label="Last 7 days" value={s ? inr(s.cost_7d) : "…"} sub={s ? `${s.sends_7d} sent` : ""} />
        <Card label="Delivered / failed" value={s ? `${s.total_sent} / ${s.total_failed}` : "…"} sub="sent / failed" />
      </div>

      <div className="mt-8">
        <span className="mb-2 block font-mono text-xs font-semibold uppercase tracking-wide text-muted">Last 30 days</span>
        <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {days.length === 0 ? <p className="p-4 font-body text-sm text-muted">No sends yet.</p> : days.map((d) => (
            <div key={d.day} className="flex items-center gap-4 px-4 py-2.5 font-mono text-sm">
              <span className="text-muted">{new Date(d.day).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
              <span className="text-foreground">{d.sends} sent</span>
              <span className="ml-auto font-semibold text-primary">{inr(d.cost)}</span>
            </div>
          ))}
        </div>
      </div>
      <p className="mt-4 font-body text-xs text-muted">More views (by event, by template, by campaign) coming as we enhance this.</p>
    </div>
  );
}
