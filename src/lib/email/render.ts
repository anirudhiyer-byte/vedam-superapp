import { campaignShell, topImageHtml, messageToHtml, ctaButton, type EmailTemplate } from "@/lib/email/shell";

export type EmailTpl = { subject?: string | null; message?: string | null; template_style?: string | null; image?: string | null; buttons?: { label: string; url: string }[] | null };

// escape admin-entered button text as HTML (the message body is intentionally rich HTML; button label is plain text)
const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
// only http(s) button URLs, with quote/bracket chars neutralised so they can't break out of the href attribute
const safeHref = (u: string) => (/^https?:\/\//i.test(u.trim()) ? u.trim().replace(/"/g, "%22").replace(/</g, "%3C").replace(/>/g, "%3E") : "");

/** Render a saved email template into full campaign HTML (server + client safe). */
export function renderEmailTemplateHtml(tpl: EmailTpl & { bg_color?: string }, vars?: Record<string, string>): string {
  let msg = tpl.message || "";
  if (vars) for (const [k, v] of Object.entries(vars)) msg = msg.split(`{{${k}}}`).join(v);
  const body = topImageHtml(tpl.image || "") + messageToHtml(msg) +
    (tpl.buttons || [])
      .map((b) => ({ label: b.label, href: safeHref(b.url || "") }))
      .filter((b) => b.label && b.href)
      .map((b) => ctaButton(escHtml(b.label), b.href)).join("");
  return campaignShell(body || "<p>&nbsp;</p>", (tpl.template_style as EmailTemplate) || "brand");
}
