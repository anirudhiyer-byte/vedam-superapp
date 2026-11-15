import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSvc } from "@supabase/supabase-js";
import { VsatApplyFrame, type VsatPrefill } from "@/components/vsat/vsat-apply-frame";
import { readVsatGate } from "@/lib/vsat/public-gate";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "VSAT Registration — Vedam School of Technology" };

/**
 * /apply — the public VSAT signup landing (designed apply.html via VsatApplyFrame,
 * full-bleed, routes to /apply/dashboard on submit).
 *
 * Visible to everyone when app_flags.vsat_public = 'on' (toggled from the Exam Center),
 * and always to admins (preview). When it is NOT public, a non-admin is sent to the
 * old early-reg at /vsat if that is still public, otherwise home — so flipping the
 * toggle is the single go-live switch and nothing is stranded in between.
 */
export default async function Page() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  let isAdmin = false;
  if (user) {
    const email = (user.email ?? "").toLowerCase();
    isAdmin = email.endsWith("@vedam.org") && !!user.email_confirmed_at;
    if (!isAdmin) { const { data } = await sb.rpc("is_admin"); isAdmin = !!data; }
  }
  const { applyPublic, legacyPublic } = await readVsatGate();
  if (!applyPublic && !isAdmin) redirect(legacyPublic ? "/vsat" : "/");

  let hasApplication = false, hasLead = false;
  let profile: VsatPrefill = {};
  const svcUrl = process.env.NEXT_PUBLIC_SUPABASE_URL, svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (user && svcUrl && svcKey) {
    const svc = createSvc(svcUrl, svcKey);
    const { data: appRow } = await svc.from("application_manager").select("application_id").eq("lead_id", user.id).maybeSingle();
    hasApplication = !!appRow;
    const { data: leadRow } = await svc.from("lead_manager").select("lead_id").eq("lead_id", user.id).maybeSingle();
    hasLead = !!leadRow;
  }
  if (user) {
    const { data: p } = await sb.from("profiles").select("full_name,email,phone,grad_year,stream,state,city").eq("id", user.id).maybeSingle();
    if (p) profile = p as VsatPrefill;
  }
  const version = process.env.VERCEL_GIT_COMMIT_SHA || "dev";
  return <VsatApplyFrame profile={profile} version={version} hasApplication={hasApplication} hasLead={hasLead} loggedIn={!!user} />;
}
