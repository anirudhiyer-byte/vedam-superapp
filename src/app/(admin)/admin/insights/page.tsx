import type { Metadata } from "next";
import { Insights } from "@/components/admin/insights/insights";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Insights", robots: { index: false, follow: false } };

export default function Page() {
  return <Insights />;
}
