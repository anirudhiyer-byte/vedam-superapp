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

  const email = (user?.email ?? "").toLowerCase();
  const emailAdmin = !!user && email.endsWith("@vedam.org") && !!user.email_confirmed_at;
  const svcUrl = process.env.NEXT_PUBLIC_SUPABASE_URL, svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const svc = user && svcUrl && svcKey ? createSvc(svcUrl, svcKey) : null;

  // Everything after getUser is independent — run it all at once instead of serially
  // (was ~5 sequential DB round-trips on every landing load).
  const [gate, isAdminRpc, appRow, leadRow, prof] = await Promise.all([
    readVsatGate(),
    user && !emailAdmin ? sb.rpc("is_admin").then((r) => !!r.data) : Promise.resolve(false),
    svc ? svc.from("application_manager").select("application_id").eq("lead_id", user!.id).maybeSingle().then((r) => r.data) : Promise.resolve(null),
    svc ? svc.from("lead_manager").select("lead_id").eq("lead_id", user!.id).maybeSingle().then((r) => r.data) : Promise.resolve(null),
    user ? sb.from("profiles").select("full_name,email,phone,grad_year,stream,state,city").eq("id", user.id).maybeSingle().then((r) => r.data) : Promise.resolve(null),
  ]);

  const isAdmin = emailAdmin || isAdminRpc;
  const { applyPublic, legacyPublic } = gate;
  if (!applyPublic && !isAdmin) redirect(legacyPublic ? "/vsat" : "/");

  const hasApplication = !!appRow, hasLead = !!leadRow;
  const profile: VsatPrefill = (prof as VsatPrefill) ?? {};
  const version = process.env.VERCEL_GIT_COMMIT_SHA || "dev";
  return <VsatApplyFrame profile={profile} version={version} hasApplication={hasApplication} hasLead={hasLead} loggedIn={!!user} />;
}
