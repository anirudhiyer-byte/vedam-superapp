"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/events", label: "Events" },
  { href: "/admin/analytics", label: "Analytics" },
];

export function AdminNav() {
  const path = usePathname();
  return (
    <nav className="flex items-center gap-1">
      {links.map((l) => {
        const active = l.href === "/admin" ? path === "/admin" : path.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href}
            className={["rounded-lg px-3 py-1.5 font-body text-sm transition-colors",
              active ? "bg-surface-warm font-semibold text-heading" : "text-muted hover:text-foreground"].join(" ")}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
