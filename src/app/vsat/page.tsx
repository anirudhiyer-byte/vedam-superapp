import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { VsatApplyFrame, type VsatPrefill } from "@/components/vsat/vsat-apply-frame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "VSAT Registration (internal)" };

/**
 * VSAT Registration (internal).
 *
 * Renders the Vedam One application page exactly as designed (the self-contained
 * /public/vedam-one/apply.html prototype, embedded full-bleed) — the design is
 * NOT rebuilt. We fetch the signed-in profile here and pass it into the iframe so
 * the form prefills (name / email / phone + class 12 year / stream / state / city);
 * campus preference and "where did you hear" stay blank as they aren't on file.
 *
 * Sits OUTSIDE the (shell) route group so the SiteHeader/Footer don't frame it.
 */
export default async function Page() {
  // ADMIN-ONLY for now. Everyone else -> the live early-registration page at /apply.
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  let isAdmin = false;
  if (user) {
    const email = (user.email ?? "").toLowerCase();
    isAdmin = email.endsWith("@vedam.org") && !!user.email_confirmed_at;
    if (!isAdmin) { const { data } = await sb.rpc("is_admin"); isAdmin = !!data; }
  }
  if (!isAdmin) redirect("/apply");

  // prefill payload — own row is readable under RLS (profiles_select_own)
  let profile: VsatPrefill = {};
  if (user) {
    const { data: p } = await sb.from("profiles")
      .select("full_name,email,phone,grad_year,stream,state,city")
      .eq("id", user.id).maybeSingle();
    if (p) profile = p as VsatPrefill;
  }

  return <VsatApplyFrame profile={profile} />;
}
