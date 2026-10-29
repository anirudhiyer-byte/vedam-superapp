import type { Metadata } from "next";
import { RegistrationFunnel } from "@/components/admin/dashboards/registration-funnel";
import { ProductLeads } from "@/components/admin/dashboards/product-leads";
import { ActiveUsers } from "@/components/admin/dashboards/active-users";
import { VsatEarly } from "@/components/admin/dashboards/vsat-early";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dashboards", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="mb-1 font-[family-name:var(--font-inter)] text-2xl font-bold text-white">Dashboards</h1>
      <p className="mb-6 font-[family-name:var(--font-inter)] text-sm text-white/50">Registration funnel, product leads, and active users — live from Vedam One.</p>
      <div className="space-y-8">
        <RegistrationFunnel />

        <div>
          <h2 className="mb-3 font-[family-name:var(--font-inter)] text-base font-bold uppercase tracking-wide text-white/60">Product Leads</h2>
          <div className="space-y-6">
            <ProductLeads product="bootcamp" title="Bootcamp" />
            <ProductLeads product="codesprint" title="CodeSprint" />
          </div>
        </div>

        <div>
          <h2 className="mb-3 font-[family-name:var(--font-inter)] text-base font-bold uppercase tracking-wide text-white/60">Active Users</h2>
          <div className="grid gap-6 lg:grid-cols-2">
            <ActiveUsers product="bootcamp" title="Bootcamp" />
            <ActiveUsers product="codesprint" title="CodeSprint" />
            <ActiveUsers product="pyq" title="PYQ" />
          </div>
          <div className="mt-6">
            <ActiveUsers product="site" title="Entire Vedam One" />
          </div>
        </div>

        <div>
          <h2 className="mb-3 font-[family-name:var(--font-inter)] text-base font-bold uppercase tracking-wide text-white/60">VSAT Early Registrations</h2>
          <VsatEarly />
        </div>
      </div>
    </div>
  );
}
