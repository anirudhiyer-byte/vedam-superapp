import type { Metadata } from "next";
import { FaqAdmin } from "@/components/admin/faq-admin";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "FAQs", robots: { index: false, follow: false } };
export default function Page() { return <FaqAdmin />; }
