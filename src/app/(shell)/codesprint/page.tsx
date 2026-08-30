import type { Metadata } from "next";
import { CsPage } from "@/components/codesprint/cs-page";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "CodeSprint" };
export default function Page() { return <CsPage />; }
