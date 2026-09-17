import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/landing-page";
export const revalidate = 3600;   // ISR: landing from CDN, refreshed hourly
export const metadata: Metadata = { title: "Vedam One — The Home of Future Engineers" };
export default function HomePage() { return <LandingPage />; }
