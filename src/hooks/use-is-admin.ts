"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** Resolves whether the signed-in user is an admin (null while loading). */
export function useIsAdmin() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(() => {
    try {
      if (typeof window === "undefined") return null;
      return sessionStorage.getItem("vedam_is_admin") === "1" ? true : null;   // trust only a positive cache; "0" -> re-verify
    } catch { return null; }   // storage blocked (in-app browser / private mode) -> unknown, re-verify via server
  });
  useEffect(() => {
    const supabase = createClient();
    let active = true;
    (async () => {
      try {
        const { data } = await supabase.rpc("is_admin");
        if (!active) return;
        setIsAdmin(!!data);
        try { sessionStorage.setItem("vedam_is_admin", data ? "1" : "0"); } catch { /* storage blocked - skip cache */ }
      } catch { if (active) setIsAdmin((v) => (v === true ? true : false)); }
    })();
    return () => { active = false; };
  }, []);
  return isAdmin;
}
