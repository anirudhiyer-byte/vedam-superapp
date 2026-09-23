"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** Resolves whether the signed-in user is an admin (null while loading). */
export function useIsAdmin() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(() => {
    if (typeof window === "undefined") return null;
    const cached = sessionStorage.getItem("vedam_is_admin");
    return cached === null ? null : cached === "1";   // instant on later pages
  });
  useEffect(() => {
    const supabase = createClient();
    let active = true;
    (async () => {
      try {
        const { data } = await supabase.rpc("is_admin");
        if (!active) return;
        setIsAdmin(!!data);
        sessionStorage.setItem("vedam_is_admin", data ? "1" : "0");
      } catch { if (active) setIsAdmin(false); }
    })();
    return () => { active = false; };
  }, []);
  return isAdmin;
}
