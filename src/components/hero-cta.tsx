"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

/** Landing hero CTA — reacts live to login/logout (no refresh needed). */
export function HeroCta() {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let active = true;
    supabase.auth.getUser().then(({ data }) => { if (active) setAuthed(!!data.user); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (active) setAuthed(!!session?.user);
    });
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, []);

  const href = authed ? "/dashboard" : "/register";
  const label = authed ? "Go to your dashboard" : "Create your account";

  return (
    <Link
      href={href}
      className="rounded-xl bg-brand-gradient px-6 py-3 text-sm font-semibold text-white transition-transform hover:-translate-y-0.5"
      style={{ boxShadow: "0 10px 30px -10px rgba(138,24,255,.65)" }}
    >
      {label}
    </Link>
  );
}
