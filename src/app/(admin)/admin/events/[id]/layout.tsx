import { EventAdminTabs } from "@/components/admin/event-admin-tabs";

export default async function Layout({
  children, params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <>
      <EventAdminTabs id={id} />
      {children}
    </>
  );
}
