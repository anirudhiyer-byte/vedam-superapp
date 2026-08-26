import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { Logo } from "@/components/logo";

/**
 * Top bar: brand on mobile (sidebar is hidden there), theme toggle, and the
 * register/login actions. Auth wiring lands in the auth phase — for now these
 * point at /login and /register placeholders.
 */
export function Topbar() {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur md:px-6">
      <div className="md:hidden">
        <Link href="/" aria-label="Vedam home">
          <Logo withWordmark={false} />
        </Link>
      </div>

      <div className="hidden md:block" />

      <div className="flex items-center gap-2">
        <ThemeToggle />
        <Link
          href="/login"
          className="rounded-lg px-3 py-2 text-sm font-medium text-foreground/75 transition-colors hover:text-foreground"
        >
          Log in
        </Link>
        <Link
          href="/register"
          className="rounded-lg bg-brand-gradient px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
        >
          Create account
        </Link>
      </div>
    </header>
  );
}
