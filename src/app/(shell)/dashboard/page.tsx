import type { Metadata } from "next";
import { Dashboard } from "@/components/dashboard";
import { PremiumDark } from "@/components/premium-dark";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Dashboard" };
export default function Page() { return <PremiumDark><Dashboard /></PremiumDark>; }
