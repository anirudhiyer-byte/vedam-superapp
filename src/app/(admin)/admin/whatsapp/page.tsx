import type { Metadata } from "next";
import { WhatsAppAdminPage } from "@/components/admin/whatsapp-admin-page";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "WhatsApp", robots: { index: false, follow: false } };
export default function Page() { return <WhatsAppAdminPage />; }
