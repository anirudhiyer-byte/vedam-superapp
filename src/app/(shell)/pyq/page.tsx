import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Plus_Jakarta_Sans } from "next/font/google";
import { createClient } from "@/lib/supabase/server";
import { PyqApp } from "@/components/pyq/pyq-app";
import { canUsePyq } from "@/lib/pyq/access";
import "@/components/pyq/pyq.css";

export const dynamic = "force-dynamic";
export const preferredRegion = "bom1"; // same region as the staging database (ap-south-1)
export const metadata: Metadata = {
  title: "PYQ Practice — Vedam",
  description: "Attempt real previous-year papers (CBSE Boards, JEE Main, WBJEE, MH-CET) online, free — with instant solutions and topic-wise analysis.",
};

// The approved PYQ design is set in Plus Jakarta Sans.
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-pyq", display: "swap" });

/** Pre-launch gate.
 *  - Production: admin-only (same posture as the College Predictor). Everyone
 *    else is sent to the Vedam One home, matching the "Soon" chip in the nav.
 *  - Staging / preview / local: open to everyone, including logged-out
 *    visitors, so the full new-user journey (S1 landing → S2 signup) can be
 *    tested end to end. Remove the production branch of this guard to launch. */
async function gate(): Promise<{ signedIn: boolean; firstName: string }> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();

  // Same rule as every PYQ API (lib/pyq/access): production is admin-only.
  if (!(await canUsePyq(sb, user))) redirect("/");

  let firstName = "";
  if (user) {
    const { data: p } = await sb.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
    firstName = ((p?.full_name as string | null) ?? "").trim().split(/\s+/)[0] ?? "";
  }
  return { signedIn: !!user, firstName };
}

export default async function Page() {
  const g = await gate();
  return (
    <div className={jakarta.variable}>
      <Suspense fallback={null}>
        <PyqApp signedIn={g.signedIn} firstName={g.firstName} />
      </Suspense>
    </div>
  );
}
