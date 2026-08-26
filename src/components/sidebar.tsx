"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/logo";

/**
 * Ecosystem nav. Events is live; the rest are placeholders that light up as we
 * build them. `ready: false` items render disabled with a "Soon" tag.
 */
const NAV = [
  { label: "Home", href: "/", ready: true },
  { label: "Events", href: "/events", ready: true },
  { label: "CodeSprint", href: "/codesprint", ready: false },
  { label: "College Predictor", href: "/college-predictor", ready: false },
  { label: "Seek Your Seniors", href: "/seek-seniors", ready: false },
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
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);

          if (!item.ready) {
            return (
              <span
                key={item.href}
                className="flex cursor-not-allowed items-center justify-between rounded-lg px-3 py-2 text-sm text-muted/70"
              >
                {item.label}
                <span className="rounded-full bg-surface-warm px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                  Soon
                </span>
              </span>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              className={[
                "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-brand-gradient text-white"
                  : "text-foreground/75 hover:bg-surface hover:text-foreground",
              ].join(" ")}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="px-5 py-4 text-[11px] leading-relaxed text-muted">
        One login for the entire Vedam ecosystem.
      </div>
    </aside>
  );
}
