import type { Metadata } from "next";
import { VsatForm } from "@/components/vsat/vsat-form";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "VSAT Interest — Register now, Start Ahead" };
export default function Page() { return <VsatForm />; }
