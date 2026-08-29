"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ACTION_LABEL, linkedInShareUrl } from "@/lib/events";

type LedgerRow = {
  points: number; action: string; app: string; created_at: string;
  events: { name: string | null } | null;
};
type CertRow = {
  id: string; kind: "participation" | "winner"; issued_on: string;
  events: { name: string | null } | null;
};
type RegEvent = {
  id: string; zoom_join_url: string | null;
  events: { name: string | null; event_code: string | null; starts_at: string | null; mode: string | null; join_link: string | null } | null;
};

const startOfWeek = () => { const d = new Date(); const day = (d.getDay() + 6) % 7; d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - day); return d; };
const startOfMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); };

export function Dashboard() {
  const [supabase] = useState(() => createClient());
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [certs, setCerts] = useState<CertRow[]>([]);
  const [regs, setRegs] = useState<RegEvent[]>([]);
  const [origin, setOrigin] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(true);

  useEffect(() => {
    setOrigin(window.location.origin);
    let active = true;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) { if (active) { setAuthed(false); setLoading(false); } return; }
      const { data: p } = await supabase.from("profiles").select("full_name").eq("id", user.id).single();
      if (active) setName(p?.full_name?.split(" ")[0] ?? "");
      const [{ data: ledger }, { data: cert }, { data: reg }] = await Promise.all([
        supabase.from("points_ledger").select("points, action, app, created_at, events(name)").order("created_at", { ascending: false }),
        supabase.from("certificates").select("id, kind, issued_on, events(name)").eq("user_id", user.id).order("issued_on", { ascending: false }),
        supabase.from("event_registrations").select("id, zoom_join_url, events(name, event_code, starts_at, mode, join_link)").eq("user_id", user.id).order("created_at", { ascending: false }),
      ]);
      if (active) { setRows((ledger as unknown as LedgerRow[]) ?? []); setCerts((cert as unknown as CertRow[]) ?? []); setRegs((reg as unknown as RegEvent[]) ?? []); setLoading(false); }
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

  const upcomingRegs = useMemo(() => {
    const now = Date.now();
    return regs.filter((r) => { const t = r.events?.starts_at ? new Date(r.events.starts_at).getTime() : null; return t == null || t >= now - 3 * 3600e3; });
  }, [regs]);

  if (loading) return <div className="mx-auto max-w-4xl px-6 py-12"><div className="h-72 animate-pulse rounded-2xl border border-border bg-surface" /></div>;
  if (!authed) return (
    <div className="mx-auto max-w-md px-6 py-24 text-center">
      <h1 className="font-display text-2xl font-bold text-heading">Your dashboard</h1>
      <p className="mt-2 font-body text-sm text-muted">Log in to see your points and certificates.</p>
      <Link href="/login?next=/dashboard" className="mt-5 inline-block rounded-xl bg-brand-gradient px-6 py-3 text-sm font-semibold text-white">Log in</Link>
    </div>
  );

  return (
    <div className="mx-auto max-w-4xl px-6 py-10 sm:px-10">
      <h1 className="font-display text-3xl font-bold tracking-tight text-heading">{name ? `Hey ${name}` : "Your dashboard"}</h1>
      <p className="mt-1 font-body text-sm text-muted">Your points and certificates across the entire Vedam ecosystem.</p>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Stat label="Total points" value={stats.total} highlight />
        <Stat label="This week" value={stats.week} />
        <Stat label="This month" value={stats.month} />
      </div>

      {/* Your registered events */}
      {upcomingRegs.length > 0 && (
        <>
          <h2 className="mb-3 mt-10 font-display text-lg font-bold text-heading">Your upcoming events</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {upcomingRegs.map((r) => {
              const online = r.events?.mode !== "offline";
              const joinUrl = r.zoom_join_url || r.events?.join_link || null;
              return (
                <div key={r.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
                  <div>
                    <p className="truncate font-display text-sm font-semibold text-heading">{r.events?.name || "Vedam event"}</p>
                    <p className="mt-0.5 font-mono text-xs text-muted">{r.events?.starts_at ? new Date(r.events.starts_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "Date TBA"}</p>
                  </div>
                  <div className="mt-auto flex gap-2">
                    {online && joinUrl && <a href={joinUrl} target="_blank" rel="noreferrer" className="flex-1 rounded-lg bg-brand-gradient px-3 py-2 text-center text-xs font-semibold text-white">Join</a>}
                    {r.events?.event_code && <Link href={`/events/${r.events.event_code}`} className="flex-1 rounded-lg border border-border px-3 py-2 text-center text-xs font-semibold text-foreground hover:bg-surface-warm">Details</Link>}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Your certificates */}
      <div className="mt-10 flex items-center justify-between">
        <h2 className="font-display text-lg font-bold text-heading">Your certificates</h2>
        {certs.length > 0 && <span className="font-mono text-xs text-muted">{certs.length}</span>}
      </div>
      {certs.length === 0 ? (
        <p className="mt-2 font-body text-sm text-muted">No certificates yet — take part in an event and they&apos;ll show up here.</p>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {certs.map((c) => {
            const winner = c.kind === "winner";
            return (
              <div key={c.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-display text-sm font-semibold text-heading">{c.events?.name || "Vedam event"}</p>
                    <p className="mt-0.5 font-body text-xs text-muted">Issued {new Date(c.issued_on).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })}</p>
                  </div>
                  <span className={["shrink-0 rounded-full px-2.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide", winner ? "bg-[linear-gradient(120deg,#B8860B,#F5C542)] text-[#3a2a00]" : "bg-surface-warm text-accent"].join(" ")}>
                    {winner ? "🏆 Winner" : "Participation"}
                  </span>
                </div>
                <div className="mt-auto flex gap-2">
                  <Link href={`/certificate?c=${c.id}`} className="flex-1 rounded-lg border border-border px-3 py-2 text-center text-xs font-semibold text-foreground hover:bg-surface-warm">View</Link>
                  <a href={linkedInShareUrl(`${origin}/certificate?c=${c.id}`)} target="_blank" rel="noreferrer" className="flex-1 rounded-lg bg-[#0A66C2] px-3 py-2 text-center text-xs font-semibold text-white">Share</a>
                </div>
              </div>
            );
          })}
        </div>
      )}

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
