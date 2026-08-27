"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ACTION_LABEL } from "@/lib/events";

type LedgerRow = {
  points: number; action: string; app: string; created_at: string;
  events: { name: string | null } | null;
};

const startOfWeek = () => { const d = new Date(); const day = (d.getDay() + 6) % 7; d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - day); return d; };
const startOfMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); };

export function Dashboard() {
  const [supabase] = useState(() => createClient());
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) { if (active) { setAuthed(false); setLoading(false); } return; }
      const { data: p } = await supabase.from("profiles").select("full_name").eq("id", u.user.id).single();
      if (active) setName(p?.full_name?.split(" ")[0] ?? "");
      const { data } = await supabase
        .from("points_ledger")
        .select("points, action, app, created_at, events(name)")
        .order("created_at", { ascending: false });
      if (active) { setRows((data as unknown as LedgerRow[]) ?? []); setLoading(false); }
    })();
    return () => { active = false; };
  }, [supabase]);

  const stats = useMemo(() => {
    const total = rows.reduce((s, r) => s + r.points, 0);
    const wk = startOfWeek().getTime(), mo = startOfMonth().getTime();
    const week = rows.filter((r) => new Date(r.created_at).getTime() >= wk).reduce((s, r) => s + r.points, 0);
    const month = rows.filter((r) => new Date(r.created_at).getTime() >= mo).reduce((s, r) => s + r.points, 0);
    return { total, week, month };
  }, [rows]);

  if (loading) return <div className="mx-auto max-w-4xl px-6 py-12"><div className="h-72 animate-pulse rounded-2xl border border-border bg-surface" /></div>;
  if (!authed) return (
    <div className="mx-auto max-w-md px-6 py-24 text-center">
      <h1 className="font-display text-2xl font-bold text-heading">Your dashboard</h1>
      <p className="mt-2 font-body text-sm text-muted">Log in to see your points and activity.</p>
      <Link href="/login?next=/dashboard" className="mt-5 inline-block rounded-xl bg-brand-gradient px-6 py-3 text-sm font-semibold text-white">Log in</Link>
    </div>
  );

  return (
    <div className="mx-auto max-w-4xl px-6 py-10 sm:px-10">
      <h1 className="font-display text-3xl font-bold tracking-tight text-heading">{name ? `Hey ${name}` : "Your dashboard"}</h1>
      <p className="mt-1 font-body text-sm text-muted">Your points across the entire Vedam ecosystem.</p>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Stat label="Total points" value={stats.total} highlight />
        <Stat label="This week" value={stats.week} />
        <Stat label="This month" value={stats.month} />
      </div>

      <h2 className="mb-3 mt-10 font-display text-lg font-bold text-heading">Recent activity</h2>
      {rows.length === 0 ? (
        <p className="font-body text-sm text-muted">No points yet — register for an event, show up, and share your certificate to start earning.</p>
      ) : (
        <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
          {rows.slice(0, 40).map((r, i) => (
            <div key={i} className="flex items-center justify-between gap-4 p-4">
              <div className="min-w-0">
                <p className="font-body text-sm font-medium text-foreground">
                  {ACTION_LABEL[r.action] || r.action}
                  {r.events?.name ? <span className="text-muted"> · {r.events.name}</span> : null}
                </p>
                <p className="mt-0.5 font-mono text-[11px] uppercase tracking-wide text-muted">
                  {r.app} · {new Date(r.created_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}
                </p>
              </div>
              <span className="shrink-0 font-display text-sm font-bold text-accent">+{r.points}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={["rounded-2xl border border-border p-5", highlight ? "bg-brand-gradient text-white" : "bg-surface"].join(" ")}>
      <div className={["font-mono text-[10px] font-semibold uppercase tracking-wide", highlight ? "text-white/80" : "text-muted"].join(" ")}>{label}</div>
      <div className={["mt-1 font-display text-3xl font-bold", highlight ? "text-white" : "text-heading"].join(" ")}>{value.toLocaleString("en-IN")}</div>
    </div>
  );
}
