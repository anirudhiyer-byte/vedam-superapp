/**
 * PeerPath · booking result codes → what the applicant sees.
 *
 * pp_book (in the database) decides; this file only turns its code into a plain
 * popup. Nothing from the database error is ever shown — unknown shapes become
 * SERVER. Pure (no I/O), so it is unit-tested.
 */
import { PEERPATH_LINKS } from "./constants";

export const BOOK_CODES = [
  "OK",
  "NOT_LOGGED_IN",
  "RATE_LIMITED",
  "INVALID",
  "BOOKING_CLOSED",
  "NOT_REGISTERED",
  "PAYMENT_PENDING",
  "EMAIL_NOT_VERIFIED",
  "SLOT_UNAVAILABLE",
  "RESCHEDULE_CLOSED",
  "LIMIT_REACHED",
  "SERVER",
  "FORBIDDEN",
] as const;

export type BookCode = (typeof BOOK_CODES)[number];
export type BookFailCode = Exclude<BookCode, "OK">;
export type BookResult = { ok: true; code: "OK"; id: string } | { ok: false; code: BookFailCode };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isCode = (c: unknown): c is BookCode => typeof c === "string" && (BOOK_CODES as readonly string[]).includes(c);

/** Read pp_book's (or our route's) answer. Anything unexpected is a SERVER failure. */
export function parseBookResult(data: unknown): BookResult {
  if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, code: "SERVER" };
  const d = data as { ok?: unknown; code?: unknown; id?: unknown };
  if (d.ok === true && d.code === "OK" && typeof d.id === "string" && UUID.test(d.id)) return { ok: true, code: "OK", id: d.id };
  if (d.ok === false && isCode(d.code) && d.code !== "OK") return { ok: false, code: d.code };
  return { ok: false, code: "SERVER" };
}

/** `raw` if it is a path on this site (kept exactly as given), else "". */
function sameSitePath(raw: string): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "";
  try {
    const base = "https://same-site.invalid";
    if (new URL(raw, base).origin !== base) return "";
  } catch {
    return "";
  }
  return raw;
}

/** Add ?next=<returnTo> to a link — only if returnTo is a page on this site. */
export function withReturn(base: string, returnTo: string): string {
  const u = new URL(base, "https://same-site.invalid");
  const next = sameSitePath(returnTo);
  if (next) u.searchParams.set("next", next);
  return u.pathname + u.search;
}

/**
 * `action` = a link button. `verifyEmail` = the popup verifies the login email in place
 * (email OTP) instead of sending the user to another page — there is no page that would
 * reliably do it (existing applicants are sent away from /apply before its email step).
 */
export type Popup = { title: string; body: string; action?: { label: string; href: string }; verifyEmail?: true };

/** The popup for a failed booking. `returnTo` = this booking page; `seniorPath` = the senior's free times. */
export function popupFor(code: BookFailCode, ctx: { returnTo: string; seniorPath: string }): Popup {
  switch (code) {
    case "PAYMENT_PENDING":
      return {
        title: "Payment not completed",
        body: "Chats with seniors open once your VSAT fee is paid. Complete the payment, then come back to book this time.",
        action: { label: "Complete payment", href: withReturn(PEERPATH_LINKS.completePayment, ctx.returnTo) },
      };
    case "NOT_REGISTERED":
      return {
        title: "Not registered for VSAT",
        body: "Chats with seniors are for VSAT applicants. Register for VSAT, then come back to book this time.",
        action: { label: "Register now", href: withReturn(PEERPATH_LINKS.register, ctx.returnTo) },
      };
    case "EMAIL_NOT_VERIFIED":
      return {
        title: "Verify your email",
        body: "We send the Google Meet invite to your email. Verify it once with a code, then confirm your booking.",
        verifyEmail: true,
      };
    case "NOT_LOGGED_IN":
      return {
        title: "Please log in",
        body: "Log in to book your chat. We'll bring you back to this time.",
        action: { label: "Log in", href: withReturn(PEERPATH_LINKS.login, ctx.returnTo) },
      };
    case "SLOT_UNAVAILABLE":
      return {
        title: "This time was just taken",
        body: "Someone may have booked it a moment ago, or it is no longer open. Please pick another time.",
        action: { label: "See free times", href: ctx.seniorPath },
      };
    case "BOOKING_CLOSED":
      return { title: "Bookings are closed right now", body: "Chats with seniors are paused for the moment. Please check back soon." };
    case "LIMIT_REACHED":
      return { title: "You already have 2 upcoming chats", body: "Please finish or cancel one of them before booking another." };
    case "RESCHEDULE_CLOSED":
      return { title: "This chat can't be moved", body: "It may start within 3 hours or was already changed. You can book a new time instead." };
    case "RATE_LIMITED":
      return { title: "Too many tries", body: "Please wait a few minutes and try again." };
    case "INVALID":
      return { title: "Something looks wrong", body: "Please go back, pick the time again and try once more.", action: { label: "See free times", href: ctx.seniorPath } };
    case "FORBIDDEN":
    case "SERVER":
    default:
      return { title: "Something went wrong", body: "We couldn't book this right now. Please try again in a moment." };
  }
}
