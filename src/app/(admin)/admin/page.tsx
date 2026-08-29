import type { Metadata } from "next";
import { AdminHome } from "@/components/admin/admin-home";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };
export default function AdminPage() { return <AdminHome />; }
