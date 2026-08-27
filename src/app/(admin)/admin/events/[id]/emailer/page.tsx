import { Emailer } from "@/components/admin/emailer";
export const dynamic = "force-dynamic";
export const metadata = { title: "Emailer", robots: { index: false } };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; return <Emailer id={id} />;
}
