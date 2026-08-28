import Link from "next/link";
import { Logo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-background/85 px-5 backdrop-blur sm:px-8">
        <div className="flex items-center gap-3">
          <Link href="/admin"><Logo /></Link>
          <span className="rounded-full bg-surface-warm px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-accent">Admin</span>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/admin/events" className="font-body text-sm text-muted hover:text-foreground">Events</Link>
          <Link href="/admin/analytics" className="font-body text-sm text-muted hover:text-foreground">Analytics</Link>
          <ThemeToggle />
          <Link href="/" className="font-body text-sm text-muted hover:text-foreground">Exit</Link>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
