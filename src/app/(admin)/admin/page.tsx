import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

/**
 * Admin / internal CRM entry point. This route group has NO student sidebar.
 * Role-gating (admins only, via the existing RBAC + middleware) is added in
 * the auth phase — right now it's an unprotected placeholder.
 */
export default function AdminPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-24">
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
        Internal
      </span>
      <h1 className="mt-3 font-display text-3xl font-bold tracking-tight text-foreground">
        Vedam CRM
      </h1>
      <p className="mt-4 font-body text-base leading-relaxed text-muted">
        The internal CRM — post-payment funnel, post-payment process, activity
        and audit logs — lives here, gated to admins only.
      </p>
    </div>
  );
}
