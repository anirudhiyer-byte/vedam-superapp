"use client";
import { authUrl, type PendingAction, stashAction } from "@/lib/funnel/pending-action";

/** Logged-out CTA -> "Already have an account? / Sign up". Both routes stash the
 *  action + return to the exact URL (UTM intact); after auth the action resumes. */
export function AccountChoiceModal({ open, onClose, action, title }: { open: boolean; onClose: () => void; action: PendingAction; title?: string }) {
  if (!open) return null;
  const go = (mode: "login" | "register") => { stashAction(action); window.location.assign(authUrl(mode)); };
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)" }}>
      <div className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-white/12 p-6 text-center shadow-2xl" style={{ background: "linear-gradient(135deg,#2b135c 0%,#160a30 60%,#0b0318 100%)" }}>
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px" style={{ background: "linear-gradient(90deg,transparent,#7b5cff,transparent)" }} />
        <button onClick={onClose} aria-label="Close" className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full text-white/50 hover:text-white">✕</button>
        <h2 className="font-display text-xl font-bold text-white">{title || "Let's get you set up"}</h2>
        <p className="mt-2 font-body text-sm text-white/60">Log in or create your free Vedam One account to continue.</p>
        <div className="mt-6 space-y-3">
          <button onClick={() => go("register")} className="w-full rounded-xl bg-brand-gradient px-5 py-3 text-sm font-semibold text-white">Sign up — it&apos;s free</button>
          <button onClick={() => go("login")} className="w-full rounded-xl border border-white/20 px-5 py-3 text-sm font-semibold text-white transition-colors hover:border-[#7b5cff]">I already have an account</button>
        </div>
      </div>
    </div>
  );
}
