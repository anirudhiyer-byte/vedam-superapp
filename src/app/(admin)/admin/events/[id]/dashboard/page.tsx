import { EventDashboard } from "@/components/admin/event-dashboard";
import { EventSummaryKpis } from "@/components/admin/event-summary-kpis";
export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard", robots: { index: false } };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6">
      <EventSummaryKpis eventId={id} />
      <EventDashboard id={id} />
    </div>
  );
}
