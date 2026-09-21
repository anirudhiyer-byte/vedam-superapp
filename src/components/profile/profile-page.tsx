"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PremiumDark } from "@/components/premium-dark";

type Standing = { points: number; national_rank?: number; national_total?: number; state?: string | null; state_rank?: number };
type Prof = { full_name: string; email: string; phone: string; public_id: string; state: string | null; city: string | null; grad_year: number | null; stream: string | null; created_at: string };
type Cert = { id: string; kind: string | null; source: string | null; serial: string | null; issued_on: string; event_id: string | null; module_id: string | null };
type PointRow = { points: number; action: string; app: string; created_at: string; events?: { name: string } | null };
type Comm = { id: string; kind: string | null; ref_name: string | null; subject: string | null; sent_at: string; opened_at: string | null; html_snapshot: string | null };

const TABS = ["Basic Details", "Certificates", "Points Log", "Communications"] as const;

export function ProfilePage() {
  const [supabase] = useState(() => createClient());
  const [tab, setTab] = useState<(typeof TABS)[number]>("Basic Details");
  const [prof, setProf] = useState<Prof | null>(null);
  const [std, setStd] = useState<Standing | null>(null);
  const [certs, setCerts] = useState<Cert[]>([]);
  const [points, setPoints] = useState<PointRow[]>([]);
  const [comms, setComms] = useState<Comm[]>([]);
  const [pointSort, setPointSort] = useState<"date" | "product">("date");
  const [openComm, setOpenComm] = useState<Comm | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return;
      const uid = session.user.id;
      const { data: p } = await supabase.from("profiles").select("full_name, email, phone, public_id, state, city, grad_year, stream, created_at").eq("id", uid).maybeSingle();
      setProf(p as Prof);
      const { data: s } = await supabase.rpc("my_standing"); setStd(s as Standing);
      const { data: c } = await supabase.from("certificates").select("id, kind, source, serial, issued_on, event_id, module_id").eq("user_id", uid).order("issued_on", { ascending: false });
      setCerts((c as Cert[]) ?? []);
      const { data: pl } = await supabase.from("points_ledger").select("points, action, app, created_at, events(name)").eq("user_id", uid).order("created_at", { ascending: false });
      setPoints((pl as unknown as PointRow[]) ?? []);
      const { data: em } = await supabase.from("email_events").select("id, kind, ref_name, subject, sent_at, opened_at, html_snapshot").eq("user_id", uid).order("sent_at", { ascending: false });
      setComms((em as Comm[]) ?? []);
    })();
  }, [supabase]);

  const initials = (prof?.full_name || "V").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  const sortedPoints = useMemo(() => pointSort === "date" ? points : [...points].sort((a, b) => (a.app || "").localeCompare(b.app || "")), [points, pointSort]);

  return (
    <PremiumDark>
      <div className="mx-auto max-w-4xl px-4 py-8 text-white">
        {/* PROFILE CARD */}
        <div className="relative overflow-hidden rounded-[24px] border border-white/12 p-6 shadow-[0_24px_70px_-30px_rgba(138,24,255,0.6)]" style={{ background: "radial-gradient(120% 100% at 80% 20%,#331660 0%,#1a0b38 50%,#0b0318 100%)" }}>
          <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.14]" style={{ backgroundImage: "radial-gradient(rgba(205,165,255,0.6) 1.2px, transparent 1.5px)", backgroundSize: "22px 22px" }} />
          <div aria-hidden className="pointer-events-none absolute -right-10 -top-16 h-56 w-56 rounded-full opacity-60 blur-[50px]" style={{ background: "radial-gradient(closest-side,rgba(150,40,220,.5),transparent 70%)" }} />
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px" style={{ background: "linear-gradient(90deg,transparent,#7b5cff,transparent)" }} />
          <div className="relative flex flex-wrap items-center gap-5">
            <div className="relative grid h-20 w-20 place-items-center rounded-2xl p-[1.5px]" style={{ background: "linear-gradient(135deg,#ff2fb0,#7b5cff 55%,#2f9bff)" }}><div className="grid h-full w-full place-items-center rounded-[14px] text-2xl font-extrabold text-white" style={{ background: "linear-gradient(180deg,#2b135c,#160a30)" }}>{initials}</div></div>
            <div className="flex-1">
              <div className="font-[family-name:var(--font-inter)] text-2xl font-bold tracking-tight" style={{ background: "linear-gradient(138deg,#00cfe5 5%,#c200db 97%)", WebkitBackgroundClip: "text" as const, backgroundClip: "text" as const, WebkitTextFillColor: "transparent" as const, color: "transparent" }}>{prof?.full_name || "You"}</div>
              <div className="mt-0.5 font-mono text-xs text-white/50">{prof?.public_id} · {[prof?.city, prof?.state].filter(Boolean).join(", ")}</div>
            </div>
            <div className="flex gap-3">
              <Stat label="Points" value={std?.points ?? 0} accent="#ffe27a" />
              <Stat label="National" value={std?.national_rank ? `#${std.national_rank}` : "—"} accent="#7ad7ff" />
              <Stat label={std?.state ? std.state : "State"} value={std?.state_rank ? `#${std.state_rank}` : "—"} accent="#8fe9f5" />
            </div>
          </div>
        </div>

        {/* TABS */}
        <div className="mt-6 flex flex-wrap gap-2">
          {TABS.map((t) => tab === t
            ? <span key={t} className="relative inline-flex rounded-full p-[1.5px]" style={{ background: "linear-gradient(100deg,#ff2fb0,#7b5cff 55%,#2f9bff)", boxShadow: "0 0 16px rgba(123,92,255,.5)" }}><button onClick={() => setTab(t)} className="rounded-full px-4 py-1.5 text-sm font-semibold text-white" style={{ background: "linear-gradient(180deg,#2b135c,#160a30)" }}>{t}{t === "Certificates" && certs.length ? ` (${certs.length})` : ""}</button></span>
            : <button key={t} onClick={() => setTab(t)} className="rounded-full border border-white/15 px-4 py-1.5 text-sm font-semibold text-white/70 transition-colors hover:text-white">{t}{t === "Certificates" && certs.length ? ` (${certs.length})` : ""}</button>)}
        </div>

        <div className="mt-5">
          {tab === "Basic Details" && prof && (
            <div className="grid gap-3 sm:grid-cols-2">
              {[["Full name", prof.full_name], ["Email", prof.email], ["WhatsApp", prof.phone], ["Class 12 grad year", prof.grad_year], ["Stream", prof.stream], ["State", prof.state], ["City", prof.city], ["Member since", new Date(prof.created_at).toLocaleDateString()]].map(([k, v]) => (
                <div key={k as string} className="rounded-xl border border-white/10 bg-white/[0.04] p-3"><div className="font-mono text-[10px] uppercase tracking-wide text-white/45">{k}</div><div className="mt-0.5 font-medium">{v || "—"}</div></div>
              ))}
            </div>
          )}

          {tab === "Certificates" && (
            certs.length ? <div className="grid gap-3 sm:grid-cols-2">{certs.map((c) => (
              <div key={c.id} className="rounded-xl border border-white/12 bg-white/[0.04] p-4">
                <div className="flex items-center justify-between"><span className="font-semibold">{c.kind === "winner" ? "🏆 Winner Certificate" : "🎓 Certificate"}</span><span className="font-mono text-[10px] text-white/40">{new Date(c.issued_on).toLocaleDateString()}</span></div>
                <div className="mt-1 text-xs text-white/55">{c.source === "codesprint" ? "CodeSprint" : "Bootcamp"} · {c.serial}</div>
              </div>
            ))}</div> : <p className="text-white/40">No certificates yet — complete a bootcamp or CodeSprint module to earn one.</p>
          )}

          {tab === "Points Log" && (
            <div>
              <div className="mb-3 flex gap-2 text-xs">
                <button onClick={() => setPointSort("date")} className={pointSort === "date" ? "font-bold text-[#35e8fb]" : "text-white/50"}>By date</button>
                <span className="text-white/20">·</span>
                <button onClick={() => setPointSort("product")} className={pointSort === "product" ? "font-bold text-[#35e8fb]" : "text-white/50"}>By product</button>
              </div>
              <div className="overflow-hidden rounded-xl border border-white/10">
                <table className="w-full text-left text-sm">
                  <thead className="bg-white/[0.04] text-white/50"><tr><th className="p-3">Activity</th><th className="p-3">Product</th><th className="p-3">When</th><th className="p-3 text-right">Points</th></tr></thead>
                  <tbody>{sortedPoints.map((r, i) => (
                    <tr key={i} className="border-t border-white/8"><td className="p-3">{r.action}{r.events?.name ? ` — ${r.events.name}` : ""}</td><td className="p-3 capitalize text-white/70">{r.app}</td><td className="p-3 font-mono text-xs text-white/45">{new Date(r.created_at).toLocaleDateString()}</td><td className="p-3 text-right font-semibold text-[#ffe27a]">+{r.points}</td></tr>
                  ))}{sortedPoints.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-white/40">No points yet.</td></tr>}</tbody>
                </table>
              </div>
            </div>
          )}

          {tab === "Communications" && (
            comms.length ? <div className="space-y-2">{comms.map((c) => (
              <button key={c.id} onClick={() => c.html_snapshot && setOpenComm(c)} className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] p-3 text-left hover:bg-white/[0.06]">
                <div><div className="font-medium">{c.subject || c.ref_name || "Email"}</div><div className="font-mono text-[11px] text-white/45">✉️ Email · {c.kind} · {new Date(c.sent_at).toLocaleString()}{c.opened_at ? " · opened" : ""}</div></div>
                {c.html_snapshot && <span className="text-xs font-semibold text-[#35e8fb]">View →</span>}
              </button>
            ))}</div> : <p className="text-white/40">No communications sent to you yet.</p>
          )}
        </div>
      </div>

      {openComm?.html_snapshot && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.75)" }} onClick={() => setOpenComm(null)}>
          <div className="relative max-h-[85vh] w-full max-w-lg overflow-auto rounded-2xl bg-white" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setOpenComm(null)} className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-full bg-black/50 text-white">✕</button>
            <div dangerouslySetInnerHTML={{ __html: openComm.html_snapshot }} />
          </div>
        </div>
      )}
    </PremiumDark>
  );
}

function Stat({ label, value, accent }: { label: string; value: string | number; accent: string }) {
  return <div className="rounded-xl border border-white/12 bg-black/30 px-3 py-2 text-center"><div className="font-display text-xl font-extrabold" style={{ color: accent }}>{value}</div><div className="mt-0.5 font-mono text-[9px] uppercase tracking-wide text-white/45">{label}</div></div>;
}
