"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/logo";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { useSidebar } from "@/components/sidebar-context";

const NAV = [
  { label: "Home", href: "/" },
  { label: "Dashboard", href: "/dashboard" },
  { label: "Events", href: "/events" },
  { label: "CodeSprint", href: "/codesprint" },
  { label: "Leaderboard", href: "/leaderboard" },
];

export function Sidebar() {
  const pathname = usePathname();
  const isAdmin = useIsAdmin();
  const { collapsed } = useSidebar();

  const linkCls = (active: boolean) =>
    ["rounded-xl px-3.5 py-2.5 text-base font-bold transition-colors",
      active ? "bg-brand-gradient text-white" : "text-foreground/75 hover:bg-surface hover:text-foreground"].join(" ");

  return (
    <aside className={["hidden shrink-0 flex-col overflow-hidden bg-surface/40 transition-[width,border] duration-200 md:flex", collapsed ? "md:w-0 border-r-0" : "w-64 border-r border-border"].join(" ")}>
      <div className="flex w-64 flex-1 flex-col">
      <div className="flex h-16 items-center justify-between px-5">
        <Link href="/" aria-label="Vedam home"><Logo /></Link>
        {isAdmin && <span className="rounded-md bg-brand-gradient px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide text-white">Admin</span>}
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3 py-4">
        <p className="px-3 pb-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted">Apps</p>
        {NAV.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return <Link key={item.href} href={item.href} className={linkCls(active)}>{item.label}</Link>;
        })}

        {isAdmin && (
          <>
            <p className="px-3 pb-1 pt-4 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted">Admin</p>
            <Link href="/admin" className={linkCls(pathname === "/admin")}>Overview</Link>
            <p className="px-3 pt-2 font-body text-[11px] leading-snug text-muted">Manage + analytics live inside each app above.</p>
          </>
        )}
      </nav>

      <div className="px-5 py-4 font-body text-[11px] leading-relaxed text-muted">One login for the entire Vedam ecosystem.</div>
      </div>
    </aside>
  );
}
