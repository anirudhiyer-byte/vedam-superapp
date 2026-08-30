import type { Metadata } from "next";
import { CsAdmin } from "@/components/admin/cs-admin";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "CodeSprint admin", robots: { index: false, follow: false } };
export default function Page() { return <CsAdmin />; }
