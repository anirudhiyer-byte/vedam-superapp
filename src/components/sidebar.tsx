"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/logo";

/** Ecosystem nav — only live sections are shown. Add more as they ship. */
const NAV = [
  { label: "Home", href: "/" },
  { label: "Dashboard", href: "/dashboard" },
  { label: "Events", href: "/events" },
  { label: "Leaderboard", href: "/leaderboard" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-surface/40 md:flex">
      <div className="flex h-16 items-center px-5">
        <Link href="/" aria-label="Vedam home">
          <Logo />
        </Link>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3 py-4">
        {NAV.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={[
                "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active ? "bg-brand-gradient text-white" : "text-foreground/75 hover:bg-surface hover:text-foreground",
              ].join(" ")}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="px-5 py-4 font-body text-[11px] leading-relaxed text-muted">
        One login for the entire Vedam ecosystem.
      </div>
    </aside>
  );
}
