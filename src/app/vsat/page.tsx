import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { VsatApplyFrame, type VsatPrefill } from "@/components/vsat/vsat-apply-frame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "VSAT Registration (internal)" };

/**
 * VSAT Registration (internal).
 *
 * Renders the designed /public/vedam-one/apply.html page UNCHANGED in an iframe
 * (via VsatApplyFrame). The signed-in profile is fetched here and passed to the
 * frame so the form prefills; on "Start application" the frame creates the lead +
 * application and sends the user to the designed /vsat/dashboard.
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

  let profile: VsatPrefill = {};
  if (user) {
    const { data: p } = await sb.from("profiles")
      .select("full_name,email,phone,grad_year,stream,state,city")
      .eq("id", user.id).maybeSingle();
    if (p) profile = p as VsatPrefill;
  }

  return <VsatApplyFrame profile={profile} />;
}
