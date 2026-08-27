import { EventEditor } from "@/components/admin/event-editor";
export const dynamic = "force-dynamic";
export const metadata = { title: "Edit event", robots: { index: false } };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EventEditor id={id} />;
}
