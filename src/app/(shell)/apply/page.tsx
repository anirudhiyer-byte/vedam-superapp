import type { Metadata } from "next";
import { VsatForm } from "@/components/vsat/vsat-form";
import { VsatApplyFrame, type VsatPrefill } from "@/components/vsat/vsat-apply-frame";
import { safeNext } from "@/lib/safe-next";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSvc } from "@supabase/supabase-js";
import { readVsatGate } from "@/lib/vsat/public-gate";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "VSAT Registration — Vedam School of Technology" };

/**
 * /apply — the public VSAT entry point.
 *
 * LIVE (staging, or production once app_flags.vsat_public = 'on', or an admin
 * previewing): serves the full designed VSAT signup landing (public/vedam-one/apply.html
 * via VsatApplyFrame, which renders full-bleed and routes to /vsat/dashboard on submit).
 *
 * PRE-LAUNCH (production, flag off, non-admin): keeps serving the existing early-reg
 * form unchanged, so nothing on the live page changes until the flag is flipped. The
 * early-registration data in vsat_registrations is untouched either way.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  let isAdmin = false;
  if (user) {
    const email = (user.email ?? "").toLowerCase();
    isAdmin = email.endsWith("@vedam.org") && !!user.email_confirmed_at;
    if (!isAdmin) { const { data } = await sb.rpc("is_admin"); isAdmin = !!data; }
  }
  const { vsatLive } = await readVsatGate();

  // Pre-launch: keep the existing early-registration form for the public.
  if (!vsatLive && !isAdmin) {
    const sp = await searchParams;
    const raw = Array.isArray(sp.next) ? sp.next[0] : sp.next;
    return <VsatForm next={safeNext(raw, "") || null} />;
  }

  // Live: the full VSAT signup landing (prefilled for signed-in users).
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
