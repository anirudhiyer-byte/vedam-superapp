/**
 * VSAT emails' from-address (Phase 7, sir's review 24 Nov 2026): every VSAT email goes from the admissions address
 * (admissions@vedam.org), kept apart from PeerPath's emails.
 *
 * Set VSAT_SENDER_EMAIL (server env) to that address once it is a verified sender on SMTP2GO. Until then it is empty and
 * VSAT emails keep today's sender, so nothing breaks. The Gmail fallback (only when SMTP2GO is not configured) always
 * sends as its own account. Every VSAT email path spreads `...vsatSender()` into deliverEmail.
 */

const EMAIL = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;

export function vsatSender(env: Record<string, string | undefined> = process.env): { fromEmail?: string } {
  const v = (env.VSAT_SENDER_EMAIL ?? "").trim();
  return v && v.length <= 254 && EMAIL.test(v) ? { fromEmail: v } : {};
}
