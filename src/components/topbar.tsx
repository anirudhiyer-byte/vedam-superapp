"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ThemeToggle } from "@/components/theme-toggle";
import { Logo } from "@/components/logo";

/**
 * Auth-aware top bar. Logged out -> Log in / Create account.
 * Logged in -> the user's name + Log out. The Supabase client is created
 * inside the effect (browser only) so the static landing page never
 * instantiates it at build time.
 */
export function Topbar() {
  const router = useRouter();
  const supabaseRef = useRef<SupabaseClient | null>(null);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [name, setName] = useState<string>("");

  useEffect(() => {
    const supabase = createClient();
    supabaseRef.current = supabase;
    let active = true;

    async function load(uid: string | null) {
      if (!active) return;
      setUserId(uid);
      if (uid) {
        const { data } = await supabase.from("profiles").select("full_name").eq("id", uid).single();
        if (active) setName(data?.full_name?.split(" ")[0] ?? "");
      } else {
        setName("");
      }
      if (active) setLoading(false);
    }

    supabase.auth.getUser().then(({ data }) => load(data.user?.id ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      load(session?.user?.id ?? null);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function logOut() {
    const supabase = supabaseRef.current ?? createClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-background/80 px-4 backdrop-blur md:px-6">
      <div className="md:hidden">
        <Link href="/" aria-label="Vedam home">
          <Logo withWordmark={false} />
        </Link>
      </div>

      <div className="hidden md:block" />

      <div className="flex items-center gap-2">
        <ThemeToggle />

        {loading ? (
          <div className="h-9 w-24 rounded-lg border border-border" aria-hidden />
        ) : userId ? (
          <>
            <span className="hidden max-w-[10rem] truncate px-2 font-body text-sm text-muted sm:inline">
              {name ? `Hi, ${name}` : "Account"}
            </span>
            <button
              onClick={logOut}
              className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground/80 transition-colors hover:bg-surface hover:text-foreground"
            >
              Log out
            </button>
          </>
        ) : (
          <>
            <Link href="/login" className="rounded-lg px-3 py-2 text-sm font-medium text-foreground/75 transition-colors hover:text-foreground">
              Log in
            </Link>
            <Link href="/register" className="rounded-lg bg-brand-gradient px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90">
              Create account
            </Link>
          </>
        )}
      </div>
    </header>
  );
}
