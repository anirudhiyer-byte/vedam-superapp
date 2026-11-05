/**
 * Suppressions (Slice 2) · request schemas for Add / Remove. Strict: unknown keys are refused.
 * The database function checks everything again (and is the one that decides); this only stops junk early.
 */
import { z } from "zod";

export const SUP_CATEGORIES = ["Unsubscribe", "Bounce", "Block", "Spam", "Invalid"] as const;
/** tight on purpose: one contact per call, no bulk */
export const SUP_LIMITS = { action: "comm_suppress", perUser: 10, perIp: 30 } as const;
export const NOTE_MAX = 200;
export const REASON_MIN = 10;
export const REASON_MAX = 200;

const CTRL = /[\u0000-\u001f\u007f]/;
const EMAIL = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;.]{2,}$/;
const PHONE_TYPED = /^\+?[0-9 ()-]{10,20}$/;

/** "+91 90000 00301" / "09000000301" / "9000000301" → "919000000301"; null when not an Indian mobile. Same rule as comm__phone91. */
export function phone91(v: string): string | null {
  const d = v.replace(/\D/g, "");
  if (/^[6-9]\d{9}$/.test(d)) return `91${d}`;
  if (/^91[6-9]\d{9}$/.test(d)) return d;
  if (/^0[6-9]\d{9}$/.test(d)) return `91${d.slice(1)}`;
  return null;
}

export const isValidEmail = (v: string) => !CTRL.test(v) && v.trim().length <= 254 && EMAIL.test(v.trim().toLowerCase());
export const isValidMobile = (v: string) => !CTRL.test(v) && PHONE_TYPED.test(v.trim()) && phone91(v) !== null;

export const addBody = z
  .object({
    channel: z.enum(["Email", "WhatsApp"]),
    contact: z.string().min(1).max(254),
    category: z.enum(SUP_CATEGORIES),
    note: z.string().max(NOTE_MAX).optional(),
  })
  .strict()
  .superRefine((b, ctx) => {
    const bad = (path: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path] });
    if (b.channel === "Email" ? !isValidEmail(b.contact) : !isValidMobile(b.contact)) bad("contact");
    if (b.channel === "WhatsApp" && b.category !== "Unsubscribe") bad("category");  // WhatsApp has one list (Opt-Out)
    if (b.note !== undefined && CTRL.test(b.note)) bad("note");
  });

export const removeBody = z
  .object({ reason: z.string().max(REASON_MAX) })
  .strict()
  .refine((b) => b.reason.trim().length >= REASON_MIN && !CTRL.test(b.reason), { path: ["reason"] });

export type AddBody = z.infer<typeof addBody>;
