"use client";
/**
 * Gate + return-to engine (localStorage-backed, UTM-safe).
 *
 * Any gated flow: capture the intended action + the EXACT current URL (query/UTM
 * intact) -> route through login/signup/profile-completion via a full-URL `?next=`
 * -> on return, resume(): fire the captured action and land back where they were.
 */

export type PendingAction =
  | { kind: "register_event"; eventCode: string }
  | { kind: "start_codesprint"; moduleSlug?: string }
  | { kind: "predict" }
  | { kind: "vsat_register" }
  | { kind: "complete_profile" };

const KEY = "vedam_pending_action";

/** The full path+query of where the user is right now (UTM preserved). */
export function currentReturnUrl(): string {
  if (typeof window === "undefined") return "/";
  return window.location.pathname + window.location.search + window.location.hash;
}

/** Stash the action the user was trying to do, so it survives the auth redirect. */
export function stashAction(action: PendingAction) {
  try { localStorage.setItem(KEY, JSON.stringify(action)); } catch { /* ignore */ }
}

/** Read + clear the pending action (call once on resume). */
export function takeAction(): PendingAction | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    localStorage.removeItem(KEY);
    return JSON.parse(raw) as PendingAction;
  } catch { return null; }
}

export function peekAction(): PendingAction | null {
  try { const raw = localStorage.getItem(KEY); return raw ? (JSON.parse(raw) as PendingAction) : null; } catch { return null; }
}

export function clearAction() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }

/** Build a login/register URL that returns to `returnTo` (full URL, UTM intact). */
export function authUrl(mode: "login" | "register", returnTo?: string): string {
  const back = returnTo ?? currentReturnUrl();
  return `/${mode}?next=${encodeURIComponent(back)}`;
}

/**
 * Gate helper: stash the action + send the user to signup (default) or login,
 * returning to the exact page they're on. Used by every product CTA.
 */
export function gateToAuth(action: PendingAction, mode: "login" | "register" = "register", returnTo?: string) {
  stashAction(action);
  if (typeof window !== "undefined") window.location.assign(authUrl(mode, returnTo));
}
