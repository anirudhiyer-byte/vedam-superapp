import type { Metadata } from "next";
import { Analytics } from "@/components/admin/analytics";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Analytics", robots: { index: false, follow: false } };
export default function Page() { return <Analytics />; }
