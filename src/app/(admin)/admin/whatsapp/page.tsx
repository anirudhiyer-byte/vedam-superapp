import type { Metadata } from "next";
import { WhatsAppTester } from "@/components/admin/whatsapp-tester";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "WhatsApp", robots: { index: false, follow: false } };
export default function Page() { return <WhatsAppTester />; }
