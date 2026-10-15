import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PyqApp } from "@/components/pyq/pyq-app";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "PYQ Practice — Vedam",
  description: "Solve previous-year questions (JEE Main, WBJEE, MHT-CET, Boards) in a real exam interface with instant analysis.",
};

// Pre-launch gate: PYQ Practice is admin-only for now (same posture as the
// College Predictor). Non-admins who hit /pyq directly are sent to the Vedam
// One home, matching the "Soon" state shown in the nav. Remove this guard to
// go public.
async function guardAdmin() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  let isAdmin = false;
  if (user) {
    const email = (user.email ?? "").toLowerCase();
    isAdmin = email.endsWith("@vedam.org") && !!user.email_confirmed_at;
    if (!isAdmin) { const { data } = await sb.rpc("is_admin"); isAdmin = !!data; }
  }
  if (!isAdmin) redirect("/");
}

export default async function Page() {
  await guardAdmin();
  return <PyqApp />;
}
