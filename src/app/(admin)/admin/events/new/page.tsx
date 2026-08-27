import { EventEditor } from "@/components/admin/event-editor";
export const dynamic = "force-dynamic";
export const metadata = { title: "New event", robots: { index: false } };
export default function Page() { return <EventEditor />; }
