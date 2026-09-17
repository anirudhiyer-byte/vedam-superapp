"use client";
import { useCallback, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { PendingAction } from "@/lib/funnel/pending-action";
import { stashAction } from "@/lib/funnel/pending-action";
import { AccountChoiceModal } from "./account-choice-modal";
import { ProfileGateModal } from "@/components/profile/profile-gate-modal";

/**
 * useProductGate() -> { gate, Modals }.
 *  gate(action, run):
 *    - logged out  -> AccountChoiceModal (stashes action, resumes after auth)
 *    - logged in, profile incomplete -> ProfileGateModal (resumes run() after completion)
 *    - logged in, complete -> run() immediately
 * Render <Modals/> once in the component.
 */
export function useProductGate() {
  const [supabase] = useState(() => createClient());
  const [choice, setChoice] = useState<{ action: PendingAction } | null>(null);
  const [gate, setGate] = useState<{ run: () => void; reason?: string } | null>(null);

  const runGate = useCallback(async (action: PendingAction, run: () => void, reason?: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) { stashAction(action); setChoice({ action }); return; }
    const { data: complete } = await supabase.rpc("is_profile_complete");
    if (complete) { run(); return; }
    setGate({ run, reason });
  }, [supabase]);

  const Modals = useCallback(() => (
    <>
      <AccountChoiceModal open={!!choice} onClose={() => setChoice(null)} action={choice?.action ?? { kind: "complete_profile" }} />
      <ProfileGateModal open={!!gate} onClose={() => setGate(null)} reason={gate?.reason}
        onComplete={() => { const r = gate?.run; setGate(null); r?.(); }} />
    </>
  ), [choice, gate]);

  return { gate: runGate, Modals };
}
