import { EventReminders } from "@/components/admin/event-reminders";
export const metadata = { title: "Reminders", robots: { index: false } };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; return <EventReminders eventId={id} />;
}
