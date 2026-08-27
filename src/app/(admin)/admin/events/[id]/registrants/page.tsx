import { Registrants } from "@/components/admin/registrants";
export const dynamic = "force-dynamic";
export const metadata = { title: "Registrants", robots: { index: false } };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; return <Registrants id={id} />;
}
