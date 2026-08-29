import type { Metadata } from "next";
import { Leaderboard } from "@/components/leaderboard";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Leaderboard" };
export default function Page() { return <Leaderboard />; }
