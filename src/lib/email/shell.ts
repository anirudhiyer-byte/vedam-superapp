/** Client-safe email shell + pieces (no Node deps), shared by the emailer preview and the send route. */

export type EmailTemplate = "brand" | "sunset" | "minimal" | "dark";

type Theme = { bg: string; header: string; headerText: string; card: string; text: string; muted: string; footBorder: string; headerExtra?: string; logo: string };

// Absolute base for email images — update on domain cutover to vedam.org.
const LOGO_BASE = "https://vedam-superapp.vercel.app";

const THEMES: Record<EmailTemplate, Theme> = {
  brand:   { bg: "#f4f2f8", header: "linear-gradient(125deg,#2B135C 0%,#5b1ec9 55%,#8A18FF 100%)", headerText: "#ffffff", card: "#ffffff", text: "#1c1733", muted: "#7a7790", footBorder: "#ece9f3", logo: LOGO_BASE + "/vedam-logo-dark.png" },
  sunset:  { bg: "#fff5ec", header: "linear-gradient(120deg,#F97D03 0%,#E80074 100%)", headerText: "#ffffff", card: "#ffffff", text: "#2b1733", muted: "#8a6a70", footBorder: "#f6e4d8", logo: LOGO_BASE + "/vedam-logo-dark.png" },
  minimal: { bg: "#f6f6f9", header: "#ffffff", headerText: "#2B135C", card: "#ffffff", text: "#1c1733", muted: "#7a7790", footBorder: "#eeeeee", headerExtra: "border-bottom:1px solid #eee;", logo: LOGO_BASE + "/vedam-logo.png" },
  dark:    { bg: "#0e0a1c", header: "linear-gradient(125deg,#2B135C 0%,#8A18FF 100%)", headerText: "#ffffff", card: "#181230", text: "#e9e4fb", muted: "#a99fc9", footBorder: "#2a2150", logo: LOGO_BASE + "/vedam-logo-dark.png" },
};

export const EMAIL_TEMPLATES: { key: EmailTemplate; label: string }[] = [
  { key: "brand", label: "Brand violet" },
  { key: "sunset", label: "Sunset" },
  { key: "minimal", label: "Minimal" },
  { key: "dark", label: "Dark" },
];

export function campaignShell(bodyHtml: string, template: EmailTemplate = "brand"): string {
  const t = THEMES[template] || THEMES.brand;
  return `<!doctype html><html><body style="margin:0;padding:24px 0;background:${t.bg}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${t.bg}"><tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${t.card};border-radius:16px;overflow:hidden;box-shadow:0 8px 30px rgba(43,19,92,.10)">
      <tr><td style="background:${t.header};padding:26px 34px;${t.headerExtra || ""}"><img src="${t.logo}" alt="Vedam School of Technology" height="30" style="height:30px;display:block;border:0" /></td></tr>
      <tr><td style="padding:30px 34px;font:400 15px/1.65 Arial,sans-serif;color:${t.text}">${bodyHtml}</td></tr>
      <tr><td style="padding:18px 34px 22px;border-top:1px solid ${t.footBorder};font:400 12px Arial,sans-serif;color:${t.muted}" align="center">Pune &middot; Gurugram &nbsp;|&nbsp; <a href="https://vedam.org" style="color:#8A18FF;text-decoration:none;font-weight:700">vedam.org</a></td></tr>
    </table></td></tr></table></body></html>`;
}

/** Full-width image at the top of the email body. */
export function topImageHtml(url: string): string {
  if (!url || !/^https?:\/\//.test(url)) return "";
  return `<img src="${url}" width="100%" alt="" style="display:block;width:100%;max-width:100%;border-radius:12px;margin:0 0 20px" />`;
}

/** Gradient CTA button. */
export function ctaButton(text: string, url: string): string {
  if (!text || !url) return "";
  return `<div style="text-align:center;margin:14px 0"><a href="${url}" style="display:inline-block;background:linear-gradient(95deg,#F97D03 0%,#8A18FF 100%);color:#fff;text-decoration:none;font:800 15px Arial,sans-serif;padding:14px 34px;border-radius:11px">${text}</a></div>`;
}

/** Turn a plain-text message into simple paragraphs; pass through if it already contains HTML. */
export function messageToHtml(msg: string): string {
  if (/<[a-z][\s\S]*>/i.test(msg)) return msg;
  return msg.split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${p.replace(/\n/g, "<br>")}</p>`).join("");
}

// legacy single-arg button used by transactional routes
export function buttonHtml(text: string, url: string): string { return ctaButton(text, url); }
