import type { Metadata } from "next";
import { RegistrationFunnel } from "@/components/admin/dashboards/registration-funnel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dashboards", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="mb-1 font-[family-name:var(--font-inter)] text-2xl font-bold text-white">Dashboards</h1>
      <p className="mb-6 font-body text-sm text-white/50">Registration funnel, product leads, and active users — live from Vedam One.</p>
      <div className="space-y-6">
        <RegistrationFunnel />
      </div>
    </div>
  );
}
