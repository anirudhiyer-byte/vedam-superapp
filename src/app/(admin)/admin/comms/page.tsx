import type { Metadata } from "next";
import { CommsHub } from "@/components/admin/comms-hub";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Communications", robots: { index: false, follow: false } };
export default function Page() { return <CommsHub />; }
