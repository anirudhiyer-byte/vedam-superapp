import type { Metadata } from "next";
import { CollegePredictor } from "@/components/predict/college-predictor";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "JEE Main 2026 College Predictor — Vedam", description: "AI-based JEE Main 2026 college predictor. Predict your college & branch from your rank, free." };
export default function Page() { return <CollegePredictor />; }
