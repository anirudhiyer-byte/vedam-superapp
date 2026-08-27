import type { Metadata } from "next";
import { EventDetail } from "@/components/events/event-detail";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Event" };

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <EventDetail code={code} />;
}
