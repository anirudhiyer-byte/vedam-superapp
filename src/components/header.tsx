"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/logo";
import { useIsAdmin } from "@/hooks/use-is-admin";

const NAV = [
  { label: "Home", href: "/" },
  { label: "Bootcamps", href: "/bootcamps" },
  { label: "CodeSprint", href: "/codesprint" },
  { label: "College Predictor", href: "/predict" },
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
    ["rounded-xl px-4 py-2 font-body text-[15px] font-bold transition-colors",
      active ? "bg-brand-gradient text-white" : "text-muted hover:bg-surface hover:text-foreground"].join(" ");
  const itemCls = "flex items-center gap-3 rounded-xl px-3 py-2.5 font-body text-sm font-semibold text-foreground hover:bg-surface-warm";

  if (pathname === "/") return null;
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-[color-mix(in_srgb,rgb(var(--background))_82%,transparent)] backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-5 sm:px-8">
        <Link href="/" aria-label="Vedam One home" className="flex items-center gap-2">
          <Logo />
        </Link>
        <nav className="ml-4 hidden items-center gap-1 sm:flex md:ml-8">
          {NAV.map((n) => {
            const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
            return <Link key={n.href} href={n.href} className={linkCls(active)}>{n.label}</Link>;
          })}
        </nav>

        <div className="relative ml-auto" ref={menuRef}>
          {me ? (
            <>
              <button onClick={() => setOpen((v) => !v)} aria-label="Profile menu"
                className="grid h-10 w-10 place-items-center rounded-full bg-brand-gradient font-display text-base font-extrabold text-white ring-2 ring-transparent transition hover:ring-border-strong">
                {initial}
              </button>
              {open && (
                <div className="absolute right-0 top-12 w-72 overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_24px_50px_-20px_rgba(43,19,92,0.4)]">
                  <div className="border-b border-border p-4">
                    <div className="font-display text-base font-extrabold text-heading">{me.name}</div>
                    {me.contact && <div className="mt-0.5 truncate font-mono text-xs text-muted">{me.contact}</div>}
                    {me.uid && <div className="mt-1 font-mono text-[11px] text-[#a49cbe]">{me.uid}</div>}
                  </div>
                  <div className="p-2">
                    {/* mobile nav (hidden on desktop where header shows links) */}
                    <div className="sm:hidden">
                      {NAV.map((n) => <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className={itemCls}>{n.label}</Link>)}
                      <div className="my-1.5 h-px bg-border" />
                    </div>
                    <Link href="/dashboard" onClick={() => setOpen(false)} className={itemCls}>🏠 Dashboard</Link>
                    <Link href="/leaderboard" onClick={() => setOpen(false)} className={itemCls}>🏆 Leaderboard</Link>
                    {isAdmin && <Link href="/admin" onClick={() => setOpen(false)} className={itemCls}>⚙️ Admin overview</Link>}
                    <div className="my-1.5 h-px bg-border" />
                    <button onClick={() => mounted && setTheme(isDark ? "light" : "dark")} className={itemCls + " w-full justify-between"}>
                      <span>🌙 Theme</span>
                      <span className={["relative h-5 w-9 rounded-full transition-colors", isDark ? "bg-brand-gradient" : "bg-border-strong"].join(" ")}>
                        <span className={["absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all", isDark ? "left-[18px]" : "left-0.5"].join(" ")} />
                      </span>
                    </button>
                    <div className="my-1.5 h-px bg-border" />
                    <button onClick={logout} className={itemCls + " w-full text-[#e0245e]"}>↪ Log out</button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center gap-2">
              <Link href="/login" className="rounded-xl border border-border-strong px-4 py-2 text-sm font-semibold text-foreground hover:bg-surface-warm">Log in</Link>
              <Link href="/register" className="rounded-xl bg-brand-gradient px-4 py-2 text-sm font-semibold text-white">Create account</Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
