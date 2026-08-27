import type { Metadata } from "next";
import { EventsList } from "@/components/events/events-list";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Events" };

export default function EventsPage() {
  return <EventsList />;
}
