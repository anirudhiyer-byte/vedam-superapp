import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CollegePredictor } from "@/components/predict/college-predictor";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "JEE Main 2026 College Predictor — Vedam", description: "AI-based JEE Main 2026 college predictor. Predict your college & branch from your rank, free." };

// Pre-launch gate: the College Predictor is admin-only for now. Non-admins who
// hit /predict directly are sent to the public "coming soon" page, matching the
// locked/Coming-Soon state shown in the nav. Remove this guard to go public.
async function guardAdmin() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  let isAdmin = false;
  if (user) {
    const email = (user.email ?? "").toLowerCase();
    isAdmin = email.endsWith("@vedam.org") && !!user.email_confirmed_at;
    if (!isAdmin) { const { data } = await sb.rpc("is_admin"); isAdmin = !!data; }
  }
  if (!isAdmin) redirect("/college-predictor");
}

export default async function Page() {
  await guardAdmin();
  return <CollegePredictor />;
}
