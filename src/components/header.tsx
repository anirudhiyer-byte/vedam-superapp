"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/logo";
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
    ["font-body text-[15px] font-medium transition-colors",
      active
        ? "rounded-md bg-[#7629fc] px-2.5 py-0.5 text-white"
        : "rounded-lg px-3 py-1 text-white/75 hover:bg-white/10 hover:text-white"].join(" ");
  const itemCls = "flex items-center gap-3 rounded-xl px-3 py-2.5 font-body text-sm font-semibold text-white/90 hover:bg-white/10";

  if (pathname === "/") return null;
  return (
    <header className="sticky top-0 z-30 border-b border-white/10 text-white backdrop-blur-md" style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.85), rgba(11,3,24,0.65))" }}>
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-5 sm:px-8">
        <Link href="/" aria-label="Vedam One home" className="flex items-center gap-2">
          <Logo />
        </Link>
        <nav className="ml-4 hidden items-center gap-1 sm:flex md:ml-8">
          {NAV.map((n) => {
            const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
            if (n.soon && !isAdmin) {
              return (
                <span key={n.href} className="flex cursor-not-allowed items-center gap-1.5 rounded-lg px-3 py-1 font-body text-[15px] font-medium text-white/35" title="Coming soon">
                  {n.label}
                  <span className="rounded-full border border-white/20 px-1.5 py-px font-mono text-[8px] font-bold uppercase tracking-wide text-white/45">Soon</span>
                </span>
              );
            }
            return <Link key={n.href} href={n.href} className={linkCls(active)}>{n.label}</Link>;
          })}
        </nav>

        <div className="relative ml-auto" ref={menuRef}>
          {me ? (
            <>
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
            </>
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
