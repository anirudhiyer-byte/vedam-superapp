import type { Metadata } from "next";
import { DailyDashboard } from "@/components/profile/daily-dashboard";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Daily Dashboard", robots: { index: false, follow: false } };
export default function Page() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-6 font-[family-name:var(--font-inter)] text-2xl font-bold text-white">Daily Dashboard</h1>
      <DailyDashboard />
    </div>
  );
}
