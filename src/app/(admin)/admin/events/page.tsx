import { AdminEventsList } from "@/components/admin/admin-events-list";
export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Events", robots: { index: false } };
export default function Page() { return <AdminEventsList />; }
