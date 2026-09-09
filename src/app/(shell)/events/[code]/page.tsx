import type { Metadata } from "next";
import { EventDetail } from "@/components/events/event-detail";
import { PremiumDark } from "@/components/premium-dark";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Event" };

export default async function EventDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <PremiumDark><EventDetail code={code} /></PremiumDark>;
}
