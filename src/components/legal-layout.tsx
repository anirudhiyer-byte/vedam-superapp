import Link from "next/link";
import { Logo } from "@/components/logo";

export function LegalLayout({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link href="/" aria-label="Vedam home"><Logo /></Link>
          <Link href="/" className="font-body text-sm text-muted hover:text-foreground">← Back to Vedam</Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="font-display text-3xl font-bold tracking-tight text-heading">{title}</h1>
        <p className="mt-2 font-mono text-xs uppercase tracking-wide text-muted">Last updated: {updated}</p>
        <div className="legal mt-8 space-y-6 font-body text-[15px] leading-relaxed text-foreground/90">
          {children}
        </div>
      </main>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-3xl flex-wrap gap-4 px-6 py-6 font-body text-sm text-muted">
          <Link href="/privacy" className="hover:text-foreground">Privacy Policy</Link>
          <Link href="/terms" className="hover:text-foreground">Terms of Service</Link>
          <span className="ml-auto">© {new Date().getFullYear()} SET Education Technology Pvt. Ltd.</span>
        </div>
      </footer>
    </div>
  );
}

export function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="font-display text-lg font-bold text-heading">{children}</h2>;
}
export function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <H2>{heading}</H2>
      {children}
    </section>
  );
}
