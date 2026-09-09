"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { createClient } from "@/lib/supabase/client";
import { useIsAdmin } from "@/hooks/use-is-admin";

const NAV: { label: string; href: string; soon?: boolean }[] = [
  { label: "Home", href: "/" },
  { label: "Bootcamps", href: "/events" },
  { label: "CodeSprint", href: "/codesprint", soon: true },
  { label: "College Predictor", href: "/predict", soon: true },
];

export function Header() {
  const [supabase] = useState(() => createClient());
  const pathname = usePathname();
  const router = useRouter();
  const isAdmin = useIsAdmin();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [me, setMe] = useState<{ name: string; contact: string; uid: string } | null>(null);
  const [points, setPoints] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const u = session?.user;
      if (!u) { setMe(null); return; }
      const { data: p } = await supabase.from("profiles").select("full_name, email, phone, public_id").eq("id", u.id).maybeSingle();
      const name = (p?.full_name || u.email?.split("@")[0] || "Vedam learner") as string;
      const contact = (p?.email || u.email || p?.phone || u.phone || "") as string;
      setMe({ name, contact, uid: (p?.public_id as string) || "" });
      const { data: pts } = await supabase.from("points_ledger").select("points").eq("user_id", u.id);
      setPoints((pts as { points: number }[] ?? []).reduce((a, r) => a + (r.points || 0), 0));
    })();
  }, [supabase, pathname]);

  useEffect(() => {
    function onClick(e: MouseEvent) { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false); }
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  async function logout() { await supabase.auth.signOut(); setOpen(false); router.push("/"); router.refresh(); }
  const isDark = theme === "dark";
  const initial = (me?.name?.trim()?.[0] || "V").toUpperCase();

  const linkCls = (active: boolean) =>
    ["rounded-lg px-3.5 py-1.5 font-[family-name:var(--font-inter)] text-[15px] font-medium transition-colors",
      active ? "bg-[#7629fc] text-white" : "text-white/85 hover:bg-[#7629fc] hover:text-white"].join(" ");
  const itemCls = "flex items-center gap-3 rounded-xl px-3 py-2.5 font-body text-sm font-semibold text-white/90 hover:bg-white/10";

  if (pathname === "/") return null;
  return (
    <header className="sticky top-0 z-30 text-white backdrop-blur-md" style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.85) 20%, rgba(0,0,0,0.45) 60%, transparent)" }}>
      <div className="relative mx-auto flex h-[72px] max-w-[1800px] items-center justify-between px-6 sm:px-10">
        <a href="https://www.vedam.org" aria-label="Vedam School of Technology" className="flex items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/vedam-logo-dark.png?v=2" alt="Vedam School of Technology" className="h-8 w-auto sm:h-9" />
        </a>
        {/* centered, evenly-spaced nav — matches the landing */}
        <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-2 lg:flex">
          {NAV.map((n) => {
            const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
            if (n.soon && !isAdmin) {
              return (
                <span key={n.href} className="flex cursor-not-allowed items-center gap-1.5 rounded-lg px-3 py-1 font-[family-name:var(--font-inter)] text-[15px] font-medium text-white/35" title="Coming soon">
                  {n.label}
                  <span className="rounded-full border border-white/20 px-1.5 py-px font-mono text-[8px] font-bold uppercase tracking-wide text-white/45">Soon</span>
                </span>
              );
            }
            return <Link key={n.href} href={n.href} className={linkCls(active)}>{n.label}</Link>;
          })}
        </nav>

        <div className="relative" ref={menuRef}>
          {me ? (
            <div className="flex items-center gap-2.5">
              <span className="flex items-center gap-1.5 rounded-full border border-white/15 bg-black/40 px-3 py-1.5 text-sm font-semibold text-white transition-all hover:border-white/40 hover:shadow-[0_0_16px_rgba(255,201,60,0.4)]">
                <span className="hidden sm:inline text-white/70">Total</span>
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden><defs><linearGradient id="hdrGold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#FFF1B8" /><stop offset="0.5" stopColor="#FFC93C" /><stop offset="1" stopColor="#E39A00" /></linearGradient></defs><path d="M12 2l2.9 6.3 6.9.7-5.1 4.7 1.5 6.8L12 17.8 5.9 21.2l1.5-6.8L2.3 9.7l6.9-.7z" fill="url(#hdrGold)" stroke="#fff6d6" strokeWidth="0.5" /></svg>
                {points}
              </span>
              <button onClick={() => setOpen((v) => !v)} aria-label="Profile menu"
                className="grid h-10 w-10 place-items-center rounded-full bg-brand-gradient font-display text-base font-extrabold text-white ring-2 ring-white/0 transition-all hover:ring-white/60 hover:shadow-[0_0_18px_rgba(138,24,255,0.6)]">
                {initial}
              </button>
              {open && (
                <div className="absolute right-0 top-12 w-72 overflow-hidden rounded-2xl border border-white/12 bg-[#160a30] shadow-2xl">
                  <div className="border-b border-white/10 p-4">
                    <div className="font-display text-base font-extrabold text-white">{me.name}</div>
                    {me.contact && <div className="mt-0.5 truncate font-mono text-xs text-white/50">{me.contact}</div>}
                    {me.uid && <div className="mt-1 font-mono text-[11px] text-[#a49cbe]">{me.uid}</div>}
                  </div>
                  <div className="p-2">
                    {/* mobile nav (hidden on desktop where header shows links) */}
                    <div className="sm:hidden">
                      {NAV.map((n) => (n.soon && !isAdmin)
                        ? <span key={n.href} className={itemCls.replace("hover:bg-white/10", "") + " cursor-not-allowed text-white/35"}>{n.label}<span className="ml-auto rounded-full border border-white/20 px-1.5 py-px font-mono text-[8px] font-bold uppercase text-white/45">Soon</span></span>
                        : <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className={itemCls}>{n.label}</Link>)}
                      <div className="my-1.5 h-px bg-white/10" />
                    </div>
                    <Link href="/dashboard" onClick={() => setOpen(false)} className={itemCls}>🏠 Dashboard</Link>
                    <Link href="/leaderboard" onClick={() => setOpen(false)} className={itemCls}>🏆 Leaderboard</Link>
                    {isAdmin && <Link href="/admin" onClick={() => setOpen(false)} className={itemCls}>⚙️ Admin overview</Link>}
                    <div className="my-1.5 h-px bg-white/10" />
                    <button onClick={() => mounted && setTheme(isDark ? "light" : "dark")} className={itemCls + " w-full justify-between"}>
                      <span>🌙 Theme</span>
                      <span className={["relative h-5 w-9 rounded-full transition-colors", isDark ? "bg-brand-gradient" : "bg-border-strong"].join(" ")}>
                        <span className={["absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all", isDark ? "left-[18px]" : "left-0.5"].join(" ")} />
                      </span>
                    </button>
                    <div className="my-1.5 h-px bg-white/10" />
                    <button onClick={logout} className={itemCls + " w-full text-[#e0245e]"}>↪ Log out</button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link href="/login" className="rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10">Log in</Link>
              <Link href="/register" className="rounded-xl bg-brand-gradient px-4 py-2 text-sm font-semibold text-white">Create account</Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
