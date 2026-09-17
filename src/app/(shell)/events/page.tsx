import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { EventsPage } from "@/components/events/events-page";
import type { EventRow } from "@/lib/events";

export const revalidate = 60;   // ISR: public events list from CDN, refreshed each minute
export const metadata: Metadata = { title: "Events" };

export default async function Page() {
  let initialEvents: EventRow[] = [];
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("events").select("*").neq("status", "draft").order("starts_at", { ascending: true });
    if (data) initialEvents = data as EventRow[];
  } catch { /* fall back to client fetch */ }
  return <EventsPage initialEvents={initialEvents} />;
}
