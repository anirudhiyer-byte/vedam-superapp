"use client";
import { ProfileCompletionForm } from "./profile-completion-form";

/** Popup shown from the profile dropdown ("Complete your profile") and the product gate. */
export function ProfileGateModal({ open, onClose, onComplete, reason }: { open: boolean; onClose: () => void; onComplete: () => void; reason?: string }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)" }}>
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-white/12 p-6 shadow-2xl" style={{ background: "linear-gradient(135deg,#2b135c 0%,#160a30 60%,#0b0318 100%)" }}>
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px" style={{ background: "linear-gradient(90deg,transparent,#7b5cff,transparent)" }} />
        <button onClick={onClose} aria-label="Close" className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full text-white/50 hover:text-white">✕</button>
        <h2 className="font-display text-xl font-bold text-white">Complete your profile</h2>
        <p className="mt-2 font-body text-sm leading-relaxed text-white/60">{reason || "To access Bootcamps, events, CodeSprint and other Vedam One products, please fill these details."} <b className="text-[#8fe9f5]">Takes 30 seconds.</b></p>
        <div className="mt-5"><ProfileCompletionForm onComplete={onComplete} /></div>
        <button onClick={onClose} className="mt-3 w-full font-body text-sm text-white/50 hover:text-white/80">I&apos;ll do this later →</button>
      </div>
    </div>
  );
}
