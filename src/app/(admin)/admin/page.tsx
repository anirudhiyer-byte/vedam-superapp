import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

export default function AdminPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <span className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-accent">Internal</span>
      <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-heading">Vedam Admin</h1>
      <p className="mt-4 font-body text-base leading-relaxed text-muted">
        Manage the Vedam ecosystem. The CRM — post-payment funnel and process — lands here next.
      </p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <Link href="/admin/events" className="rounded-2xl border border-border bg-surface p-5 transition-transform hover:-translate-y-1">
          <h2 className="font-display text-base font-semibold text-heading">Events</h2>
          <p className="mt-1 font-body text-sm text-muted">Host, edit, and manage events + registrations.</p>
        </Link>
        <Link href="/admin/analytics" className="rounded-2xl border border-border bg-surface p-5 transition-transform hover:-translate-y-1">
          <h2 className="font-display text-base font-semibold text-heading">Analytics</h2>
          <p className="mt-1 font-body text-sm text-muted">Registration sources, trends, and funnel across events.</p>
        </Link>
      </div>
    </div>
  );
}
