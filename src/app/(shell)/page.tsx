import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/landing-page";
export const revalidate = 3600;   // ISR: landing from CDN, refreshed hourly
export const metadata: Metadata = { title: "Vedam One — The Home of Future Engineers" };
// PeerPath home card: shown everywhere except production (hidden on prod until it's ready).
// VERCEL_ENV is "production" on the prod deployment, "preview" on staging/feature deploys.
export default function HomePage() { return <LandingPage showPeerpath={process.env.VERCEL_ENV !== "production"} />; }
