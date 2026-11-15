/**
 * Communication Manager · LIVE Suppressions Add / Remove (Slice 2): checks and messages used by the screen.
 * The same rules run again in the API (zod) and in the database function, which is the one that decides.
 */

export const NOTE_MAX = 200;
export const REASON_MIN = 10;
export const REASON_MAX = 200;

const CTRL = /[\u0000-\u001f\u007f]/;
const EMAIL = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;.]{2,}$/;
const PHONE_TYPED = /^\+?[0-9 ()-]{10,20}$/;

/** "+91 90000 00301" / "09000000301" / "9000000301" → "919000000301"; null when not an Indian mobile */
export function phone91(v: string): string | null {
  const d = v.replace(/\D/g, "");
  if (/^[6-9]\d{9}$/.test(d)) return `91${d}`;
  if (/^91[6-9]\d{9}$/.test(d)) return d;
  if (/^0[6-9]\d{9}$/.test(d)) return `91${d.slice(1)}`;
  return null;
}
export const isValidEmail = (v: string) => !CTRL.test(v) && v.trim().length <= 254 && EMAIL.test(v.trim().toLowerCase());
export const isValidMobile = (v: string) => !CTRL.test(v) && PHONE_TYPED.test(v.trim()) && phone91(v) !== null;
export const reasonIssue = (v: string): string | null =>
  v.trim().length < REASON_MIN ? `Give a reason of at least ${REASON_MIN} characters.`
    : v.trim().length > REASON_MAX ? `Keep the reason to ${REASON_MAX} characters or fewer.`
      : CTRL.test(v) ? "Write the reason on one line." : null;

export const SUP_ADD_MESSAGES: Record<string, string> = {
  INVALID: "Check the contact, the list and the note, then try again.",
  FORBIDDEN: "Only admins can change suppression lists.",
};
export const SUP_REMOVE_MESSAGES: Record<string, string> = {
  LOCKED: "This entry came from a STOP reply, an unsubscribe link or a bounce, so it cannot be removed here.",
  NOT_FOUND: "This entry is no longer on the list. Refresh to see the latest.",
  INVALID: `Give a reason of ${REASON_MIN} to ${REASON_MAX} characters, on one line.`,
  FORBIDDEN: "Only admins can change suppression lists.",
};
export const ONE_AT_A_TIME_ADD = "On live data, add one contact at a time.";
export const ONE_AT_A_TIME_REMOVE = "On live data, remove one entry at a time (use the bin icon on its row).";
