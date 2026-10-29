/**
 * PeerPath · Talk to a Senior — booking ownership proof.
 *
 * PeerPath has no login (by design). A booking is owned by whoever made it, and
 * ownership is proven with the email + phone they booked with — the same pair the
 * database functions (pp_booking_by_id / pp_cancel / pp_give_feedback) check. We
 * keep that pair in a per-device cookie so the confirmation and feedback pages,
 * which render on the server, can prove ownership without the applicant retyping
 * it every time. It is the user's own contact detail on their own device; it is
 * base64-wrapped (obfuscation, not security) and never put in a URL.
 *
 * The real security boundary is the database check, not this cookie.
 */
export const PROOF_COOKIE = "pp_me";
const MAX_AGE = 60 * 60 * 24 * 180; // 180 days

export type Proof = { email: string; phone: string };

export function encodeProof(p: Proof): string {
  try {
    return btoa(encodeURIComponent(JSON.stringify({ e: p.email, p: p.phone })));
  } catch {
    return "";
  }
}

export function decodeProof(raw: string | undefined | null): Proof | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(decodeURIComponent(atob(raw))) as { e?: unknown; p?: unknown };
    if (typeof o.e === "string" && typeof o.p === "string" && o.e && o.p) {
      return { email: o.e, phone: o.p };
    }
  } catch {
    /* malformed cookie: treat as no proof */
  }
  return null;
}

/** Client-only: remember this device's booking owner so server pages can prove it. */
export function setProofCookie(email: string, phone: string): void {
  if (typeof document === "undefined") return;
  const v = encodeProof({ email: email.trim(), phone: phone.trim() });
  if (!v) return;
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${PROOF_COOKIE}=${v}; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax${secure}`;
}

/** Client-only: read the remembered owner (for RPC calls made from the browser). */
export function getProofClient(): Proof | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${PROOF_COOKIE}=([^;]*)`));
  return m ? decodeProof(m[1]) : null;
}
