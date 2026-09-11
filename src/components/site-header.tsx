"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useIsAdmin } from "@/hooks/use-is-admin";

const NAV: { label: string; href: string; soon?: boolean }[] = [
  { label: "Home", href: "/" },
  { label: "Bootcamps", href: "/events" },
  { label: "Codesprint", href: "/codesprint", soon: true },
  { label: "College Predictor", href: "/predict", soon: true },
];

export function SiteHeader() {
  const [supabase] = useState(() => createClient());
  const pathname = usePathname();
  const router = useRouter();
  const isAdmin = useIsAdmin();
  const [authed, setAuthed] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [uid, setUid] = useState("");
  const [points, setPoints] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;
    async function loadUser(session: Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"]) {
      if (!mounted) return;
      if (session?.user) {
        setAuthed(true);
        const { data: p } = await supabase.from("profiles").select("full_name, phone, email, public_id").eq("id", session.user.id).maybeSingle();
        if (!mounted) return;
        setName(p?.full_name || "You");
        setEmail(p?.email || session.user.email || "");
        setPhone(p?.phone || "");
        setUid(p?.public_id || "");
        const { data: pts } = await supabase.from("points_ledger").select("points").eq("user_id", session.user.id);
        if (!mounted) return;
        setPoints((pts as { points: number }[] ?? []).reduce((a, r) => a + (r.points || 0), 0));
      } else {
        // signed out — clear everything so the UI updates instantly
        setAuthed(false); setName(""); setEmail(""); setPhone(""); setUid(""); setPoints(0); setMenuOpen(false);
      }
    }
    supabase.auth.getSession().then(({ data }) => loadUser(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => { loadUser(session); });
    const onClick = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener("mousedown", onClick);
    return () => { mounted = false; sub.subscription.unsubscribe(); document.removeEventListener("mousedown", onClick); };
  }, [supabase]);

  const initials = name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "V";
  async function logout() {
    setMenuOpen(false);
    setAuthed(false); setName(""); setPoints(0); // instant UI update
    await supabase.auth.signOut();               // fires onAuthStateChange -> full clear
    router.push("/");
    router.refresh();
  }

  // tighter/reduced active pill; Coming-Soon gating for non-staff
  const linkCls = (active: boolean) =>
    ["text-[15px] font-medium transition-colors", active ? "rounded-full bg-[#7629fc] px-3.5 py-1 text-white" : "rounded-full px-3.5 py-1 text-white/85 hover:bg-[#7629fc] hover:text-white"].join(" ");

  return (
    <header className="sticky top-0 z-40 backdrop-blur-md" style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.85) 15%, rgba(0,0,0,0.45) 45%, transparent 78%)" }}>
      <div className="relative mx-auto flex max-w-[1800px] items-center justify-between px-6 py-4 sm:px-10">
        <a href="https://www.vedam.org" className="flex items-center">
          <Image src="/landing/vedam-logo-dark.png" alt="Vedam School of Technology" width={220} height={52} priority className="h-9 w-auto sm:h-10" />
        </a>
        <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-2 lg:flex">
          {NAV.map((n) => {
            const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
            if (n.soon && !isAdmin) {
              return (
                <span key={n.href} className="flex cursor-not-allowed items-center gap-1.5 rounded-lg px-3 py-1 text-[15px] font-medium text-white/35" title="Coming soon">
                  {n.label}<span className="rounded-full border border-white/20 px-1.5 py-px font-mono text-[8px] font-bold uppercase tracking-wide text-white/45">Soon</span>
                </span>
              );
            }
            return <Link key={n.href} href={n.href} className={linkCls(active)}>{n.label}</Link>;
          })}
        </nav>
        <div className="flex items-center gap-2.5">
          {authed ? (
            <>
              <span className="flex items-center gap-2 rounded-full border border-white/15 bg-black/40 px-3.5 py-1.5 text-sm font-semibold text-white transition-all hover:border-white/40 hover:shadow-[0_0_16px_rgba(255,201,60,0.4)]"><span className="hidden text-white/70 sm:inline">Total</span><svg viewBox="0 0 24 24" width="17" height="17" aria-hidden><defs><linearGradient id="shGold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#FFF1B8" /><stop offset="0.5" stopColor="#FFC93C" /><stop offset="1" stopColor="#E39A00" /></linearGradient></defs><path d="M12 2l2.9 6.3 6.9.7-5.1 4.7 1.5 6.8L12 17.8 5.9 21.2l1.5-6.8L2.3 9.7l6.9-.7z" fill="url(#shGold)" stroke="#fff6d6" strokeWidth="0.5" /></svg>{points}</span>
              <div ref={menuRef} className="relative">
                <button onClick={() => setMenuOpen((o) => !o)} className="grid h-10 w-10 place-items-center rounded-full text-[15px] font-semibold text-white ring-2 ring-white/0 transition-all hover:ring-white/60 hover:shadow-[0_0_18px_rgba(138,24,255,0.6)]" style={{ background: "linear-gradient(135deg,#9a4dff,#7629fc)" }}>{initials}</button>
                {menuOpen && (
                  <div className="absolute right-0 top-12 z-50 w-52 overflow-hidden rounded-xl border border-white/10 bg-[#160a30] py-1.5 text-sm shadow-2xl">
                    <div className="border-b border-white/10 px-4 py-2.5">
                      <div className="font-semibold text-white">{name}</div>
                      <div className="mt-0.5 text-xs text-white/50">{[email, phone].filter(Boolean).join(" | ")}</div>
                      {uid && <div className="mt-0.5 font-mono text-[11px] text-white/40">{uid}</div>}
                    </div>
                    <Link href="/dashboard" className="block px-4 py-2 text-white/90 hover:bg-white/5">Dashboard</Link>
                    <Link href="/leaderboard" className="block px-4 py-2 text-white/90 hover:bg-white/5">Leaderboard</Link>
                    <button onClick={logout} className="block w-full px-4 py-2 text-left text-[#ff6a8e] hover:bg-white/5">↪ Log out</button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <Link href="/login" className="group/si relative inline-flex rounded-full p-[1.5px] transition-all hover:-translate-y-0.5 hover:shadow-[0_0_28px_rgba(255,47,176,0.7),0_0_50px_rgba(47,155,255,0.55)]" style={{ background: "linear-gradient(100deg,#ff2fb0,#7b5cff 55%,#2f9bff)", boxShadow: "0 0 16px rgba(123,92,255,.55)" }}>
              <span className="inline-flex items-center rounded-full px-4 py-1.5 text-[15px] font-medium text-white transition-colors group-hover/si:bg-[rgba(138,24,255,0.3)]" style={{ background: "linear-gradient(180deg,#2b135c,#160a30)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.22)" }}>Sign in</span>
            </Link>
          )}
          <button onClick={() => setNavOpen((o) => !o)} className="ml-1 grid h-10 w-10 place-items-center rounded-lg border border-white/15 text-white lg:hidden">☰</button>
        </div>
      </div>
      {navOpen && (
        <div className="relative z-30 mx-6 mb-2 rounded-xl border border-white/10 bg-[#160a30] p-2 lg:hidden">
          {NAV.map((n) => (n.soon && !isAdmin)
            ? <span key={n.href} className="flex cursor-not-allowed items-center gap-1.5 rounded-lg px-4 py-2.5 font-medium text-white/35">{n.label}<span className="ml-auto rounded-full border border-white/20 px-1.5 py-px font-mono text-[8px] font-bold uppercase text-white/45">Soon</span></span>
            : <Link key={n.href} href={n.href} onClick={() => setNavOpen(false)} className="block rounded-lg px-4 py-2.5 font-medium text-white hover:bg-white/5">{n.label}</Link>)}
        </div>
      )}
    </header>
  );
}
