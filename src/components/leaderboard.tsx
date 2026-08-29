"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Row = { user_id: string; name: string; points: number; rnk: number };
type Range = "today" | "week" | "month" | "custom";

const shortName = (n: string) => {
  const parts = n.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0] || "Vedam learner";
};

function rangeBounds(r: Range, from: string, to: string): [Date, Date] {
  const now = new Date();
  if (r === "custom") return [new Date(from + "T00:00:00"), new Date(to + "T23:59:59")];
  const start = new Date();
  if (r === "today") start.setHours(0, 0, 0, 0);
  else if (r === "week") { const day = (now.getDay() + 6) % 7; start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - day); }
  else { start.setDate(1); start.setHours(0, 0, 0, 0); }
  return [start, now];
}

export function Leaderboard() {
  const [supabase] = useState(() => createClient());
  const [range, setRange] = useState<Range>("week");
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10));
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState<Row[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { supabase.auth.getSession().then(({ data }) => setMe(data.session?.user.id ?? null)); }, [supabase]);

  useEffect(() => {
    let active = true; setLoading(true);
    const [f, t] = rangeBounds(range, from, to);
    supabase.rpc("points_leaderboard", { p_from: f.toISOString(), p_to: t.toISOString(), p_limit: 100 })
      .then(({ data }) => { if (active) { setRows((data as Row[]) ?? []); setLoading(false); } });
    return () => { active = false; };
  }, [supabase, range, from, to]);

  const myRow = useMemo(() => rows.find((r) => r.user_id === me), [rows, me]);
  const top3 = rows.slice(0, 3);
  const rest = rows.slice(3);
  const medal = ["🥇", "🥈", "🥉"];
  const podiumBg = ["linear-gradient(135deg,#F97D03,#E80074)", "linear-gradient(135deg,#8A18FF,#5b1ec9)", "linear-gradient(135deg,#12b3a6,#2B135C)"];

  return (
    <div className="mx-auto max-w-3xl px-6 py-12 sm:px-10">
      <span className="inline-flex items-center gap-2 font-mono text-xs font-semibold lowercase tracking-[0.12em] text-accent">
        <span className="h-1.5 w-1.5 rounded-full bg-primary" style={{ boxShadow: "0 0 0 3px rgba(249,125,3,.22)" }} />// leaderboard
      </span>
      <h1 className="mt-3 font-display text-4xl font-extrabold tracking-tight text-heading">Top builders</h1>
      <p className="mt-1 font-body text-sm text-muted">Points earned across every Vedam event. Show up, take part, climb.</p>

      {/* range tabs */}
      <div className="mt-6 flex flex-wrap gap-2">
        {(["today", "week", "month", "custom"] as const).map((r) => (
          <button key={r} onClick={() => setRange(r)}
            className={["rounded-lg px-4 py-2 font-mono text-xs font-semibold capitalize transition-colors",
              range === r ? "bg-brand-gradient text-white" : "border border-border-strong bg-surface text-muted hover:text-foreground"].join(" ")}>
            {r === "week" ? "This week" : r === "month" ? "This month" : r}
          </button>
        ))}
        {range === "custom" && (
          <div className="flex items-center gap-2">
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-border bg-surface px-2.5 py-2 font-mono text-xs text-foreground outline-none" />
            <span className="font-mono text-xs text-muted">→</span>
            <input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-border bg-surface px-2.5 py-2 font-mono text-xs text-foreground outline-none" />
          </div>
        )}
      </div>

      {loading ? (
        <div className="mt-8 space-y-3">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-16 animate-pulse rounded-2xl border border-border bg-surface" />)}</div>
      ) : rows.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-border-strong bg-surface p-10 text-center">
          <p className="font-display text-lg font-bold text-heading">No points in this window yet</p>
          <p className="mt-1 font-body text-sm text-muted">As people join events and earn points, they&apos;ll show up here.</p>
        </div>
      ) : (
        <>
          {/* podium */}
          <div className="mt-8 grid grid-cols-3 gap-3">
            {top3.map((r, i) => (
              <div key={r.user_id} className={["relative flex flex-col items-center rounded-2xl border border-border p-4 text-center", i === 0 ? "sm:-translate-y-2" : ""].join(" ")}
                style={{ background: podiumBg[i], color: "#fff" }}>
                <div className="text-2xl">{medal[i]}</div>
                <div className="mt-1 line-clamp-1 font-display text-sm font-bold">{shortName(r.name)}</div>
                <div className="mt-1 font-mono text-lg font-extrabold">{r.points.toLocaleString("en-IN")}</div>
                <div className="font-mono text-[10px] uppercase tracking-wide opacity-80">pts</div>
                {r.user_id === me && <span className="mt-1 rounded-full bg-white/25 px-2 py-0.5 font-mono text-[9px] font-bold uppercase">You</span>}
              </div>
            ))}
          </div>

          {/* the rest */}
          {rest.length > 0 && (
            <div className="mt-4 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
              {rest.map((r) => (
                <div key={r.user_id} className={["flex items-center gap-4 px-4 py-3", r.user_id === me ? "bg-surface-warm" : ""].join(" ")}>
                  <span className="w-7 text-center font-mono text-sm font-bold text-muted">{r.rnk}</span>
                  <span className="flex-1 truncate font-body text-sm font-medium text-heading">{shortName(r.name)}{r.user_id === me && <span className="ml-2 rounded-full bg-brand-gradient px-2 py-0.5 font-mono text-[9px] font-bold uppercase text-white">You</span>}</span>
                  <span className="font-mono text-sm font-bold text-primary">{r.points.toLocaleString("en-IN")}</span>
                </div>
              ))}
            </div>
          )}

          {/* your rank if outside the list shown */}
          {myRow && myRow.rnk > 3 && (
            <p className="mt-4 text-center font-mono text-xs text-muted">You&apos;re <b className="text-accent">#{myRow.rnk}</b> with {myRow.points.toLocaleString("en-IN")} pts this {range === "custom" ? "range" : range}.</p>
          )}
        </>
      )}
    </div>
  );
}
