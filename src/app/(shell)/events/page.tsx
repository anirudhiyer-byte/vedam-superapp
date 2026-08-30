import type { Metadata } from "next";
import { EventsPage } from "@/components/events/events-page";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Events" };
export default function Page() { return <EventsPage />; }
