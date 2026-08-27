import { EventDashboard } from "@/components/admin/event-dashboard";
export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard", robots: { index: false } };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; return <EventDashboard id={id} />;
}
