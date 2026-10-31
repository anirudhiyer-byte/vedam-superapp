/**
 * PeerPath · add / verify the login email in place (booking popup, code EMAIL_MISSING;
 * EMAIL_NOT_VERIFIED on the 0035 database).
 *
 * Used only when the user's own VSAT application has no email (0036). pp_book then falls
 * back to the login email, and only trusts auth.users.email_confirmed_at, which Supabase sets when the user
 * enters the email-change OTP (`updateUser({ email })` → `verifyOtp({ type: "email_change" })`,
 * the same pattern /apply and the profile form already use). These helpers are pure so they
 * are unit-tested; they turn Supabase errors into plain messages and never show the raw text.
 */

type AuthErr = { message?: string; status?: number; code?: string } | null | undefined;

const EMAIL = /^[^\s@<>(),;:"\[\]]+@[^\s@<>(),;:"\[\]]+\.[^\s@<>(),;:"\[\]]+$/;

/** A single plain email, trimmed + lower-cased, or null. */
export function cleanEmail(raw: string): string | null {
  const e = raw.trim().toLowerCase();
  return e.length <= 254 && EMAIL.test(e) ? e : null;
}

/** The OTP digits (6–10), or null. */
export function cleanCode(raw: string): string | null {
  const d = raw.replace(/\D/g, "");
  return d.length >= 6 && d.length <= 10 ? d : null;
}

type AuthUserLite = { email?: string | null; new_email?: string | null; email_confirmed_at?: string | null } | null | undefined;
const same = (a: string | null | undefined, b: string) => (a ?? "").trim().toLowerCase() === b;

/**
 * What happened after `updateUser({ email })`:
 *  - "done"          → this address is already the login's VERIFIED email (nothing to do)
 *  - "resend_signup" → it is already the login's email but was never confirmed; Auth sends
 *                      nothing for an unchanged email, so ask for a fresh confirmation code
 *  - "code_sent"     → a normal email-change code went to the new address
 */
export function afterSend(user: AuthUserLite, email: string): "done" | "resend_signup" | "code_sent" {
  if (same(user?.email, email)) return user?.email_confirmed_at ? "done" : "resend_signup";
  return "code_sent";
}

/**
 * What happened after `verifyOtp` (read back with getUser):
 *  - "done"            → the login email is now this address and verified
 *  - "confirm_current" → "Secure email change" is on: the code for the CURRENT address is still needed
 *  - "retry"           → anything else (don't pretend it worked)
 */
export function afterVerify(user: AuthUserLite, email: string): "done" | "confirm_current" | "retry" {
  if (same(user?.email, email) && user?.email_confirmed_at) return "done";
  if (same(user?.new_email, email) && user?.email) return "confirm_current";
  return "retry";
}

const WAIT = "Please wait a minute before asking for another code.";

function tooMany(e: NonNullable<AuthErr>): boolean {
  return e.status === 429 || (e.code ?? "").startsWith("over_") || /rate limit|security purposes|too many/i.test(e.message ?? "");
}

export function sendCodeError(e: AuthErr): string {
  if (!e) return "We couldn't send the code. Please try again.";
  if (e.code === "email_exists" || /already (been )?registered|already exists|already in use/i.test(e.message ?? "")) {
    return "This email is already linked to another account. Please use a different email.";
  }
  if (tooMany(e)) return WAIT;
  if (e.code === "email_address_invalid" || e.code === "validation_failed") return "Please enter a valid email address.";
  return "We couldn't send the code. Please try again.";
}

export function verifyCodeError(e: AuthErr): string {
  if (!e) return "That code didn't work. Please try again.";
  if (tooMany(e)) return WAIT;
  if (e.code === "otp_expired" || /expired|invalid/i.test(e.message ?? "")) {
    return "That code is wrong or has expired. Check it, or ask for a new one.";
  }
  return "That code didn't work. Please try again.";
}
