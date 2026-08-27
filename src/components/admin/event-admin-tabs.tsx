"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function EventAdminTabs({ id }: { id: string }) {
  const pathname = usePathname();
  const base = `/admin/events/${id}`;
  const tabs = [
    { label: "Edit", href: base },
    { label: "Registrants", href: `${base}/registrants` },
    { label: "Dashboard", href: `${base}/dashboard` },
    { label: "Emailer", href: `${base}/emailer` },
  ];
  return (
    <div className="mx-auto max-w-4xl px-6 pt-8">
      <div className="flex gap-1 border-b border-border">
        {tabs.map((t) => {
          const active = pathname === t.href;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={[
                "rounded-t-lg px-4 py-2 text-sm font-medium transition-colors",
                active ? "border-b-2 border-[color:rgb(var(--accent))] text-heading" : "text-muted hover:text-foreground",
              ].join(" ")}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
