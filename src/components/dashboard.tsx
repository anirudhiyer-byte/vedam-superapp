"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ACTION_LABEL, linkedInShareUrl } from "@/lib/events";
import { CertificateModal } from "@/components/events/certificate-modal";

type LedgerRow = { points: number; action: string; app: string; created_at: string; events: { name: string | null } | null };
type CertRow = { id: string; kind: "participation" | "winner" | "completion"; source: string; event_id: string | null; module_id: string | null; issued_on: string; events: { name: string | null } | null; cs_modules: { title: string | null } | null };
type RegEvent = { id: string; zoom_join_url: string | null; events: { name: string | null; event_code: string | null; starts_at: string | null; mode: string | null; join_link: string | null } | null };

const startOfWeek = () => { const d = new Date(); const day = (d.getDay() + 6) % 7; d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - day); return d; };
const startOfMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); };
const fdate = (s: string) => new Date(s).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });

export function Dashboard() {
  const [supabase] = useState(() => createClient());
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [certs, setCerts] = useState<CertRow[]>([]);
  const [regs, setRegs] = useState<RegEvent[]>([]);
  const [origin, setOrigin] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(true);
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
  const [showActivity, setShowActivity] = useState(false);
  const [openCert, setOpenCert] = useState<string | null>(null);

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
        supabase.from("certificates").select("id, kind, source, event_id, module_id, issued_on, events(name), cs_modules(title)").eq("user_id", user.id).order("issued_on", { ascending: false }),
        supabase.from("event_registrations").select("id, zoom_join_url, events(name, event_code, starts_at, mode, join_link)").eq("user_id", user.id).order("created_at", { ascending: false }),
      ]);
      if (active) { setRows((ledger as unknown as LedgerRow[]) ?? []); setCerts((cert as unknown as CertRow[]) ?? []); setRegs((reg as unknown as RegEvent[]) ?? []); setLoading(false); }
    })();
    return () => { active = false; };
  }, [supabase]);

  const stats = useMemo(() => {
    const total = rows.reduce((s, r) => s + r.points, 0);
    const wk = startOfWeek().getTime(), mo = startOfMonth().getTime();
    return { total, week: rows.filter((r) => new Date(r.created_at).getTime() >= wk).reduce((s, r) => s + r.points, 0), month: rows.filter((r) => new Date(r.created_at).getTime() >= mo).reduce((s, r) => s + r.points, 0) };
  }, [rows]);

  const upcomingRegs = useMemo(() => {
    const now = Date.now();
    return regs.filter((r) => { const t = r.events?.starts_at ? new Date(r.events.starts_at).getTime() : null; return t == null || t >= now - 3 * 3600e3; });
  }, [regs]);

  const eventGroups = useMemo(() => {
    const m = new Map<string, { key: string; name: string; certs: CertRow[] }>();
    certs.filter((c) => c.source !== "codesprint").forEach((c) => { const key = c.event_id || c.events?.name || c.id; if (!m.has(key)) m.set(key, { key, name: c.events?.name || "Vedam event", certs: [] }); m.get(key)!.certs.push(c); });
    return Array.from(m.values());
  }, [certs]);
  const csCerts = useMemo(() => certs.filter((c) => c.source === "codesprint"), [certs]);
  const toggleFolder = (k: string) => setOpenFolders((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

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
      <span className="inline-flex items-center gap-2 font-mono text-xs font-semibold lowercase tracking-[0.12em] text-accent">
        <span className="h-1.5 w-1.5 rounded-full bg-primary" style={{ boxShadow: "0 0 0 3px rgba(249,125,3,.22)" }} />// your journey
      </span>
      <h1 className="mt-3 font-display text-4xl font-extrabold tracking-tight text-heading">{name ? `Hey ${name} 👋` : "Your dashboard"}</h1>
      <p className="mt-1 font-body text-sm text-muted">Your points, certificates and events across the Vedam ecosystem.</p>

      {/* stats */}
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-brand-gradient p-5 text-white">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-wide text-white/80">Total points</div>
          <div className="mt-1 flex items-center gap-2.5 font-display text-4xl font-extrabold">
            <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden><defs><linearGradient id="dashGold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#FFF1B8" /><stop offset="0.5" stopColor="#FFC93C" /><stop offset="1" stopColor="#E39A00" /></linearGradient></defs><path d="M12 2l2.9 6.3 6.9.7-5.1 4.7 1.5 6.8L12 17.8 5.9 21.2l1.5-6.8L2.3 9.7l6.9-.7z" fill="url(#dashGold)" stroke="#fff6d6" strokeWidth="0.5" /></svg>
            {stats.total.toLocaleString("en-IN")}
          </div>
          <div className="pointer-events-none absolute -right-6 -top-8 h-28 w-28 rounded-full bg-white/10" />
          <span aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(125deg, rgba(255,255,255,0.22), transparent 30%)" }} />
        </div>
        <Stat label="This week" value={stats.week} />
        <Stat label="This month" value={stats.month} />
      </div>

      {/* leaderboard link */}
      <Link href="/leaderboard" className="group relative mt-3 flex items-center justify-between overflow-hidden rounded-2xl border border-border bg-surface p-4 transition-all hover:-translate-y-0.5 hover:border-[#8A18FF66]">
        <div className="flex items-center gap-3"><span className="text-xl">🏆</span><div><p className="font-display text-sm font-bold text-heading">Leaderboard</p><p className="font-mono text-[11px] text-muted">See where you rank</p></div></div>
        <span className="font-mono text-sm text-accent">→</span>
      </Link>

      {/* upcoming events */}
      {upcomingRegs.length > 0 && (
        <>
          <h2 className="mb-3 mt-10 font-display text-lg font-bold text-heading">Your upcoming events</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {upcomingRegs.map((r) => {
              const online = r.events?.mode !== "offline";
              const joinUrl = r.zoom_join_url || r.events?.join_link || null;
              return (
                <div key={r.id} className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
                  <div><p className="truncate font-display text-sm font-semibold text-heading">{r.events?.name || "Vedam event"}</p>
                    <p className="mt-0.5 font-mono text-xs text-muted">{r.events?.starts_at ? new Date(r.events.starts_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "Date TBA"}</p></div>
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

      {/* certificates: Events (per-event subfolders) + CodeSprint (flat) */}
      <h2 className="mb-3 mt-10 font-display text-lg font-bold text-heading">Your certificates</h2>
      {eventGroups.length === 0 && csCerts.length === 0 ? (
        <p className="font-body text-sm text-muted">No certificates yet — take part in an event or finish a CodeSprint module and they&apos;ll show up here.</p>
      ) : (
        <div className="space-y-2">
          {/* Events top-level folder */}
          {eventGroups.length > 0 && (
            <div className="overflow-hidden rounded-2xl border border-border bg-surface">
              <button onClick={() => toggleFolder("events")} className="flex w-full items-center gap-3 p-4 text-left">
                <span className="text-xl">{openFolders.has("events") ? "\uD83D\uDCC2" : "\uD83D\uDCC1"}</span>
                <div className="min-w-0 flex-1"><p className="font-display text-sm font-semibold text-heading">Events</p>
                  <p className="font-mono text-[11px] text-muted">{eventGroups.length} event{eventGroups.length > 1 ? "s" : ""}</p></div>
                <span className="font-mono text-xs text-muted">{openFolders.has("events") ? "\u25B2" : "\u25BC"}</span>
              </button>
              {openFolders.has("events") && (
                <div className="space-y-2 border-t border-border p-3">
                  {eventGroups.map((g) => {
                    const k = "events:" + g.key; const open = openFolders.has(k);
                    return (
                      <div key={g.key} className="overflow-hidden rounded-xl border border-border bg-background">
                        <button onClick={() => toggleFolder(k)} className="flex w-full items-center gap-3 p-3 text-left">
                          <span>{open ? "\uD83D\uDCC2" : "\uD83D\uDCC1"}</span>
                          <div className="min-w-0 flex-1"><p className="truncate font-display text-sm font-semibold text-heading">{g.name}</p>
                            <p className="font-mono text-[11px] text-muted">{g.certs.length} certificate{g.certs.length > 1 ? "s" : ""} · {g.certs.map((c) => c.kind === "winner" ? "Winner" : "Participation").join(" + ")}</p></div>
                          <span className="font-mono text-xs text-muted">{open ? "\u25B2" : "\u25BC"}</span>
                        </button>
                        {open && <div className="grid gap-3 border-t border-border p-3 sm:grid-cols-2">{g.certs.map((c) => <CertCard key={c.id} cert={c} origin={origin} onView={setOpenCert} />)}</div>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* CodeSprint top-level folder (flat) */}
          {csCerts.length > 0 && (
            <div className="overflow-hidden rounded-2xl border border-border bg-surface">
              <button onClick={() => toggleFolder("codesprint")} className="flex w-full items-center gap-3 p-4 text-left">
                <span className="text-xl">{openFolders.has("codesprint") ? "\uD83D\uDCC2" : "\uD83D\uDCC1"}</span>
                <div className="min-w-0 flex-1"><p className="font-display text-sm font-semibold text-heading">CodeSprint</p>
                  <p className="font-mono text-[11px] text-muted">{csCerts.length} certificate{csCerts.length > 1 ? "s" : ""}</p></div>
                <span className="font-mono text-xs text-muted">{openFolders.has("codesprint") ? "\u25B2" : "\u25BC"}</span>
              </button>
              {openFolders.has("codesprint") && <div className="grid gap-3 border-t border-border p-3 sm:grid-cols-2">{csCerts.map((c) => <CertCard key={c.id} cert={c} origin={origin} onView={setOpenCert} />)}</div>}
            </div>
          )}
        </div>
      )}

      {openCert && <CertificateModal certId={openCert} onClose={() => setOpenCert(null)} />}

      {/* recent activity — collapsible */}
      {rows.length > 0 && (
        <div className="mt-10">
          <button onClick={() => setShowActivity((v) => !v)} className="flex w-full items-center justify-between rounded-2xl border border-border bg-surface px-4 py-3.5">
            <span className="font-display text-lg font-bold text-heading">Recent activity</span>
            <span className="flex items-center gap-2 font-mono text-xs text-muted">{rows.length} entries {showActivity ? "▲" : "▼"}</span>
          </button>
          {showActivity && (
            <div className="mt-2 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-surface">
              {rows.slice(0, 60).map((r, i) => (
                <div key={i} className="flex items-center justify-between gap-4 p-4">
                  <div className="min-w-0"><p className="font-body text-sm font-medium text-foreground">{ACTION_LABEL[r.action] || r.action}{r.events?.name ? <span className="text-muted"> · {r.events.name}</span> : null}</p>
                    <p className="mt-0.5 font-mono text-[11px] uppercase tracking-wide text-muted">{r.app} · {fdate(r.created_at)}</p></div>
                  <span className="shrink-0 font-display text-sm font-bold text-accent">+{r.points}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}


function Spark({ seed }: { seed: number }) {
  const bars = Array.from({ length: 7 }, (_, i) => 30 + ((seed * (i + 3) * 37) % 70));
  return (
    <div className="mt-2.5 flex h-6 items-end gap-[3px]">
      {bars.map((h, i) => <span key={i} className="flex-1 rounded-[2px]" style={{ height: `${h}%`, background: "linear-gradient(180deg,#8A18FF,#F97D03)", opacity: 0.7 }} />)}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-surface p-5">
      <span aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(125deg, rgba(255,255,255,0.10), transparent 34%)" }} />
      <div className="font-mono text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 font-display text-3xl font-bold text-heading">{value.toLocaleString("en-IN")}</div>
      <Spark seed={value || 1} />
    </div>
  );
}

function CertCard({ cert: c, origin, onView }: { cert: CertRow; origin: string; onView: (id: string) => void }) {
  const winner = c.kind === "winner";
  const completion = c.source === "codesprint";
  const label = completion ? (c.cs_modules?.title || "CodeSprint") : winner ? "Winner" : "Participation";
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
      <div className="flex items-start justify-between gap-2">
        <span className={["rounded-full px-2.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide", winner ? "bg-[linear-gradient(120deg,#B8860B,#F5C542)] text-[#3a2a00]" : "bg-surface-warm text-accent"].join(" ")}>{completion ? "Completion" : winner ? "\uD83C\uDFC6 Winner" : "Participation"}</span>
        <span className="font-mono text-[10px] text-muted">{fdate(c.issued_on)}</span>
      </div>
      {completion && <p className="truncate font-display text-xs font-semibold text-heading">{label}</p>}
      <div className="mt-auto flex gap-2">
        <button onClick={() => onView(c.id)} className="flex-1 rounded-lg border border-border px-3 py-2 text-center text-xs font-semibold text-foreground hover:bg-surface-warm">View</button>
        <a href={linkedInShareUrl(`${origin}/certificate?c=${c.id}`)} target="_blank" rel="noreferrer" className="flex-1 rounded-lg bg-[#0A66C2] px-3 py-2 text-center text-xs font-semibold text-white">Share</a>
      </div>
    </div>
  );
}
