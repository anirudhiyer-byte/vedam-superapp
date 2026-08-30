import type { Metadata } from "next";
import { Suspense } from "react";
import { CsPlayer } from "@/components/codesprint/cs-player";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "CodeSprint — Learn" };
export default function Page() { return <Suspense><CsPlayer /></Suspense>; }
