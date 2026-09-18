"use client";
import { useSearchParams } from "next/navigation";
import { useIsAdmin } from "@/hooks/use-is-admin";
import { CsLanding } from "@/components/codesprint/cs-landing";
import { CsAdmin } from "@/components/admin/cs-admin";

/** Clean student hero by default. Admins reach Manage+Analytics via the profile
 *  dropdown ("Manage CodeSprint") which routes to /codesprint?admin=1. */
export function CsPage() {
  const isAdmin = useIsAdmin();
  const admin = useSearchParams().get("admin") === "1";
  if (isAdmin && admin) return <CsAdmin />;
  return <CsLanding />;
}
