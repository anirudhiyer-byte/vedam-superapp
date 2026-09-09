"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useIsAdmin } from "@/hooks/use-is-admin";

type Row = { user_id: string; public_id: string | null; name: string; state: string | null; points: number; rnk: number };
type Range = "today" | "week" | "month" | "custom";

const shortName = (n: string) => { const p = n.trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : p[0] || "Vedam learner"; };
function bounds(r: Range, from: string, to: string): [Date, Date] {
  const now = new Date();
  if (r === "custom") return [new Date(from + "T00:00:00"), new Date(to + "T23:59:59")];
  const s = new Date();
  if (r === "today") s.setHours(0, 0, 0, 0);
  else if (r === "week") { const d = (now.getDay() + 6) % 7; s.setHours(0, 0, 0, 0); s.setDate(s.getDate() - d); }
  else { s.setDate(1); s.setHours(0, 0, 0, 0); }
  return [s, now];
}

export function Leaderboard() {
  const [supabase] = useState(() => createClient());
  const isAdmin = useIsAdmin();
  const [range, setRange] = useState<Range>("week");
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10));
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState<Row[]>([]);
  const [me, setMe] = useState<{ id: string; state: string | null } | null>(null);
  const [scope, setScope] = useState<"state" | "national">("national");
  const [adminState, setAdminState] = useState<string>("");
  const [allStates, setAllStates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const { data: p } = await supabase.from("profiles").select("state").eq("id", session.user.id).maybeSingle();
        setMe({ id: session.user.id, state: p?.state ?? null });
        if (p?.state) setScope("state");
      }
    })();
  }, [supabase]);

  useEffect(() => { if (isAdmin) supabase.rpc("leaderboard_states").then(({ data }) => setAllStates((data as { state: string }[] ?? []).map((r) => r.state))); }, [isAdmin, supabase]);

  const activeState = isAdmin && adminState ? adminState : scope === "state" ? me?.state ?? null : null;

  useEffect(() => {
    let active = true; setLoading(true);
    const [f, t] = bounds(range, from, to);
    supabase.rpc("points_leaderboard", { p_from: f.toISOString(), p_to: t.toISOString(), p_limit: 100, p_state: activeState })
      .then(({ data }) => { if (active) { setRows((data as Row[]) ?? []); setLoading(false); } });
    return () => { active = false; };
  }, [supabase, range, from, to, activeState]);

  const myRow = useMemo(() => rows.find((r) => r.user_id === me?.id), [rows, me]);
  const top3 = rows.slice(0, 3);
  const rest = rows.slice(3);
  const medal = ["🥇", "🥈", "🥉"];
  const podiumBg = ["linear-gradient(135deg,#F97D03,#E80074)", "linear-gradient(135deg,#8A18FF,#5b1ec9)", "linear-gradient(135deg,#12b3a6,#2B135C)"];
  const scopeLabel = isAdmin && adminState ? adminState : scope === "state" ? (me?.state || "your state") : "nationally";

  return (
    <div className="mx-auto max-w-3xl px-6 py-12 sm:px-10">
      <span className="inline-flex items-center gap-2 font-mono text-xs font-semibold lowercase tracking-[0.12em] text-accent">
        <span className="h-1.5 w-1.5 rounded-full bg-primary" style={{ boxShadow: "0 0 0 3px rgba(249,125,3,.22)" }} />// leaderboard
      </span>
      <h1 className="mt-3 font-display text-4xl font-extrabold tracking-tight text-heading">Top builders</h1>
      <p className="mt-1 font-body text-sm text-muted">Points earned across every Vedam product.</p>

      {/* your position summary */}
      {myRow && (
        <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-border bg-brand-gradient px-5 py-3.5 text-white">
          <span className="font-display text-lg font-extrabold">You're #{myRow.rnk}</span>
          <span className="font-body text-sm text-white/85">of {rows.length} {scope === "state" && !adminState ? `in ${me?.state}` : adminState ? `in ${adminState}` : "nationally"}</span>
          <span className="ml-auto font-mono text-sm font-bold">{myRow.points.toLocaleString("en-IN")} pts</span>
          {myRow.public_id && <span className="font-mono text-xs text-white/70">· {myRow.public_id}</span>}
        </div>
      )}

      {/* controls */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-2">
          {(["today", "week", "month", "custom"] as const).map((r) => (
            <button key={r} onClick={() => setRange(r)}
              className={["rounded-lg px-3.5 py-2 font-mono text-xs font-semibold capitalize transition-colors",
                range === r ? "bg-brand-gradient text-white" : "border border-border-strong bg-surface text-muted hover:text-foreground"].join(" ")}>
              {r === "week" ? "This week" : r === "month" ? "This month" : r}
            </button>
          ))}
        </div>
        {/* scope toggle (state vs national) for users with a state */}
        {me?.state && !adminState && (
          <div className="inline-flex rounded-full border border-border bg-surface p-1">
            <button onClick={() => setScope("state")} className={["rounded-full px-3.5 py-1.5 font-mono text-xs font-semibold", scope === "state" ? "bg-heading text-white" : "text-muted"].join(" ")} style={scope === "state" ? { background: "rgb(var(--heading))" } : undefined}>My state · {me.state}</button>
            <button onClick={() => setScope("national")} className={["rounded-full px-3.5 py-1.5 font-mono text-xs font-semibold", scope === "national" ? "bg-heading text-white" : "text-muted"].join(" ")} style={scope === "national" ? { background: "rgb(var(--heading))" } : undefined}>National</button>
          </div>
        )}
        {isAdmin && (
          <label className="ml-auto flex items-center gap-2 font-mono text-xs text-muted">👑 view state
            <select value={adminState} onChange={(e) => setAdminState(e.target.value)} className="rounded-lg border border-border bg-surface px-2.5 py-1.5 font-body text-sm text-foreground outline-none">
              <option value="">National</option>
              {allStates.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        )}
      </div>

      {range === "custom" && (
        <div className="mt-3 flex items-center gap-2">
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-border bg-surface px-2.5 py-2 font-mono text-xs text-foreground" />
          <span className="font-mono text-xs text-muted">→</span>
          <input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-border bg-surface px-2.5 py-2 font-mono text-xs text-foreground" />
        </div>
      )}

      {loading ? (
        <div className="mt-8 space-y-3">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-16 animate-pulse rounded-2xl border border-border bg-surface" />)}</div>
      ) : rows.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-border-strong bg-surface p-10 text-center">
          <p className="font-display text-lg font-bold text-heading">No points {scopeLabel === "nationally" ? "yet" : `in ${scopeLabel} yet`}</p>
          <p className="mt-1 font-body text-sm text-muted">As people earn points, they&apos;ll show up here.</p>
        </div>
      ) : (
        <>
          <div className="mt-7 grid grid-cols-3 items-end gap-3">
            {top3.map((r, i) => {
              const order = i === 0 ? "order-2" : i === 1 ? "order-1" : "order-3";
              const raise = i === 0 ? "" : "mb-5";
              const init = shortName(r.name).split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
              return (
                <div key={r.user_id} className={["relative flex flex-col items-center overflow-hidden rounded-2xl border border-white/10 p-4 pt-5 text-center", order, raise].join(" ")} style={{ background: podiumBg[i], color: "#fff" }}>
                  <span aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(150deg, rgba(255,255,255,0.22), transparent 40%)" }} />
                  <div className="relative text-3xl">{medal[i]}</div>
                  <div className="relative mt-2 grid h-12 w-12 place-items-center rounded-full bg-white/25 font-display text-base font-extrabold">{init}</div>
                  <div className="relative mt-2 line-clamp-1 font-display text-sm font-bold">{shortName(r.name)}</div>
                  {r.public_id && <div className="relative font-mono text-[10px] opacity-75">{r.public_id}</div>}
                  <div className="relative mt-1.5 font-mono text-lg font-extrabold">{r.points.toLocaleString("en-IN")}</div>
                  {r.user_id === me?.id && <span className="relative mt-1 rounded-full bg-white/25 px-2 py-0.5 font-mono text-[9px] font-bold uppercase">You</span>}
                </div>
              );
            })}
          </div>
          {rest.length > 0 && (
            <div className="mt-4 space-y-2">
              {rest.map((r) => {
                const init = shortName(r.name).split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
                const mine = r.user_id === me?.id;
                return (
                  <div key={r.user_id} className={["flex items-center gap-3.5 rounded-2xl border px-4 py-3", mine ? "border-[#8A18FF] bg-[rgba(138,24,255,0.12)]" : "border-border bg-surface"].join(" ")}>
                    <span className="w-7 text-center font-mono text-sm font-bold text-muted">{r.rnk}</span>
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full font-display text-xs font-extrabold text-white" style={{ background: "linear-gradient(135deg,#9a4dff,#7629fc)" }}>{init}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-body text-sm font-medium text-heading">{shortName(r.name)}{mine && <span className="ml-2 rounded-full bg-brand-gradient px-2 py-0.5 font-mono text-[9px] font-bold uppercase text-white">You</span>}</div>
                      {r.public_id && <div className="font-mono text-[11px] text-[#a49cbe]">{r.public_id}</div>}
                    </div>
                    {!activeState && r.state && <span className="hidden font-mono text-[11px] text-muted sm:inline">{r.state}</span>}
                    <span className="font-mono text-sm font-bold text-primary">{r.points.toLocaleString("en-IN")}</span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
