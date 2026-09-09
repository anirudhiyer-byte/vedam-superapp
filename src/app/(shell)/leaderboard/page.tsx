import type { Metadata } from "next";
import { Leaderboard } from "@/components/leaderboard";
import { PremiumDark } from "@/components/premium-dark";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Leaderboard" };
export default function Page() { return <PremiumDark><Leaderboard /></PremiumDark>; }
