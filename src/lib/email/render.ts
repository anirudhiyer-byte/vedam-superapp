import { campaignShell, topImageHtml, messageToHtml, ctaButton, type EmailTemplate } from "@/lib/email/shell";

export type EmailTpl = { subject?: string | null; message?: string | null; template_style?: string | null; image?: string | null; buttons?: { label: string; url: string }[] | null };

/** Render a saved email template into full campaign HTML (server + client safe). */
export function renderEmailTemplateHtml(tpl: EmailTpl, vars?: Record<string, string>): string {
  let msg = tpl.message || "";
  if (vars) for (const [k, v] of Object.entries(vars)) msg = msg.split(`{{${k}}}`).join(v);
  const body = topImageHtml(tpl.image || "") + messageToHtml(msg) +
    (tpl.buttons || []).filter((b) => b.label && b.url).map((b) => ctaButton(b.label, b.url)).join("");
  return campaignShell(body || "<p>&nbsp;</p>", (tpl.template_style as EmailTemplate) || "brand");
}
