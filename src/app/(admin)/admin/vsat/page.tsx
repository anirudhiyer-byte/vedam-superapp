import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { VsatAdminPanel } from "@/components/admin/vsat-admin-panel";
import type { WheeboxStatus } from "@/components/admin/vsat-exam-center";
import type { VsatRoles } from "@/lib/vsat/pipeline";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "VSAT Admin Panel", robots: { index: false, follow: false } };

export default async function Page() {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  let isAdmin = false;
  let vsatRoles: VsatRoles = { admin: false, roles: [] };
  if (user) {
    const email = (user.email ?? "").toLowerCase();
    isAdmin = email.endsWith("@vedam.org") && !!user.email_confirmed_at;
    if (!isAdmin) { const { data } = await sb.rpc("is_admin"); isAdmin = !!data; }
    // VSAT pipeline roles (admin / admissions / interviewer / counsellor) come from the database
    const { data: r } = await sb.rpc("vsat_my_roles");
    if (r && typeof r === "object") {
      const o = r as { admin?: unknown; roles?: unknown };
      vsatRoles = { admin: o.admin === true, roles: Array.isArray(o.roles) ? o.roles.filter((x): x is string => typeof x === "string") : [] };
    }
  }
  // Vedam staff / admins as before; VSAT team members (e.g. an outside interviewer) get only their panels
  const onTeam = vsatRoles.admin || vsatRoles.roles.length > 0;
  if (!isAdmin && !onTeam) redirect("/");

  const base = !!process.env.WHEEBOX_BASE_URL;
  const companyCode = !!process.env.WHEEBOX_COMPANY_CODE;
  const accessToken = !!process.env.WHEEBOX_ACCESS_TOKEN;
  const privateKey = !!process.env.WHEEBOX_PRIVATE_KEY;
  const wheebox: WheeboxStatus = { base, companyCode, accessToken, privateKey, ready: base && companyCode && accessToken && privateKey };

  return <VsatAdminPanel wheebox={wheebox} staff={isAdmin} vsatRoles={vsatRoles} />;
}
