/** Vedam-branded email HTML builders (ported from vedam-events). */

const IST = "Asia/Kolkata";
const esc = (s: string) =>
  String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

export type IcsEvent = {
  name: string; mode: "online" | "offline";
  dateMs?: number; durationMin?: number;
  platform?: string; join?: string; host?: string; blurb?: string;
  zoomId?: string; zoomPw?: string; venue?: string; mapLink?: string;
  schedule?: { date?: string; slots?: { start?: string; end?: string }[] }[] | null;
};

const fmtICSDate = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const parseISTms = (date: string, time?: string) => new Date(`${date}T${time || "00:00"}:00+05:30`).getTime();

function foldICS(ics: string): string {
  return ics.split("\r\n").map((line) => {
    const bytes = Buffer.from(line, "utf8");
    if (bytes.length <= 75) return line;
    let out = "", i = 0, first = true;
    while (i < bytes.length) {
      const max = first ? 75 : 74;
      let end = Math.min(i + max, bytes.length);
      while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
      out += (first ? "" : "\r\n ") + bytes.slice(i, end).toString("utf8");
      i = end; first = false;
    }
    return out;
  }).join("\r\n");
}

function occurrences(ev: IcsEvent) {
  const isOff = ev.mode === "offline";
  const descLines: string[] = [];
  if (ev.blurb) { descLines.push(ev.blurb, ""); }
  descLines.push("Hosted by Vedam School of Technology");
  if (ev.host) descLines.push("Host: " + ev.host);
  if (isOff) { if (ev.venue) descLines.push("Venue: " + ev.venue); if (ev.mapLink) descLines.push("Directions: " + ev.mapLink); }
  else { if (ev.platform) descLines.push("Platform: " + ev.platform); if (ev.join) descLines.push("Join link: " + ev.join); if (ev.zoomId) descLines.push("Meeting ID: " + ev.zoomId); if (ev.zoomPw) descLines.push("Passcode: " + ev.zoomPw); }
  descLines.push("", "See you there!");
  const desc = descLines.join("\n");
  const location = isOff ? (ev.venue || "") : (ev.join || ev.platform || "");
  const summary = ev.host ? `${ev.name} \u00B7 Vedam (with ${ev.host})` : `${ev.name} \u00B7 Vedam`;

  const out: { startMs: number; endMs: number; location: string; summary: string; desc: string }[] = [];
  const hasSchedule = isOff && Array.isArray(ev.schedule) && ev.schedule.some((d) => d.date);
  if (hasSchedule) {
    ev.schedule!.forEach((d) => {
      if (!d.date) return;
      const slots = (d.slots || []).filter((s) => s.start);
      if (!slots.length) { const startMs = parseISTms(d.date, "09:00"); out.push({ startMs, endMs: startMs + 3 * 3600000, location, summary, desc }); }
      else slots.forEach((s) => { const startMs = parseISTms(d.date!, s.start); const endMs = s.end ? parseISTms(d.date!, s.end) : startMs + 2 * 3600000; out.push({ startMs, endMs, location, summary, desc }); });
    });
  } else {
    const startMs = ev.dateMs || Date.now();
    out.push({ startMs, endMs: startMs + (ev.durationMin || 60) * 60000, location, summary, desc });
  }
  return out;
}

export function buildICS(ev: IcsEvent, to: string, sender: string): string {
  const occ = occurrences(ev);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Vedam School of Technology//Events//EN", "METHOD:REQUEST", "CALSCALE:GREGORIAN"];
  occ.forEach((e) => {
    const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}@vedam.org`;
    lines.push(
      "BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${fmtICSDate(Date.now())}`,
      `DTSTART:${fmtICSDate(e.startMs)}`, `DTEND:${fmtICSDate(e.endMs)}`,
      `SUMMARY:${esc(e.summary)}`, `DESCRIPTION:${esc(e.desc)}`, `LOCATION:${esc(e.location)}`,
      `ORGANIZER;CN=Vedam School of Technology:mailto:${sender}`,
      `ATTENDEE;CN=${esc(to)};RSVP=TRUE:mailto:${to}`, "STATUS:CONFIRMED",
      "BEGIN:VALARM", "TRIGGER:-PT1H", "ACTION:DISPLAY", "DESCRIPTION:Reminder: 1 hour to go", "END:VALARM",
      "BEGIN:VALARM", "TRIGGER:-PT30M", "ACTION:DISPLAY", "DESCRIPTION:Reminder: 30 minutes to go", "END:VALARM",
      "END:VEVENT",
    );
  });
  lines.push("END:VCALENDAR");
  return foldICS(lines.join("\r\n"));
}

export function confirmationHtml(ev: IcsEvent, name?: string): string {
  const isOff = ev.mode === "offline";
  const istDate = (ms: number) => new Date(ms).toLocaleDateString("en-IN", { timeZone: IST, day: "numeric", month: "short", year: "numeric" });
  const detail = (label: string, val?: string) =>
    val ? `<tr><td style="padding:8px 0;font:600 12px Arial,sans-serif;color:#7a7790;width:124px;vertical-align:top">${label}</td><td style="padding:8px 0;font:700 14px Arial,sans-serif;color:#1c1733">${val}</td></tr>` : "";

  let rows = "";
  if (isOff) {
    rows += detail("&#128205;&nbsp; Venue", ev.venue);
    rows += detail("&#127908;&nbsp; Host", ev.host);
  } else {
    rows += detail("&#128197;&nbsp; Date", ev.dateMs ? istDate(ev.dateMs) : "");
    rows += detail("&#127909;&nbsp; Platform", ev.platform);
    rows += detail("&#127908;&nbsp; Host", ev.host);
    rows += detail("&#127380;&nbsp; Meeting ID", ev.zoomId);
  }
  const ctaHref = isOff ? (ev.mapLink || "") : (ev.join || "");
  const ctaLabel = isOff ? "Get directions &#8594;" : "Join the session &#8594;";
  const cta = ctaHref ? `<tr><td align="center" style="padding:24px 34px 6px"><a href="${ctaHref}" style="display:inline-block;background:#8A18FF;color:#fff;text-decoration:none;font:800 15px Arial,sans-serif;padding:15px 38px;border-radius:11px">${ctaLabel}</a></td></tr>` : "";

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f1f9;margin:0;padding:26px 12px"><tr><td align="center">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 14px 44px rgba(43,19,92,.14)">
    <tr><td style="background:linear-gradient(125deg,#2B135C 0%,#5b1ec9 55%,#8A18FF 100%);padding:32px 34px 30px">
      <div style="font:800 12px Arial,sans-serif;letter-spacing:2.5px;color:#F97D03;text-transform:uppercase">Vedam School of Technology</div>
      <div style="font:800 27px Arial,sans-serif;color:#fff;margin-top:10px;line-height:1.15">You're in! &#127881;</div>
      <div style="font:400 15px Arial,sans-serif;color:#ddd0ff;margin-top:6px">Your spot is locked for <b style="color:#fff">${ev.name}</b>.</div>
    </td></tr>
    <tr><td style="padding:30px 34px 6px">
      <p style="font:400 15px/1.65 Arial,sans-serif;color:#1c1733;margin:0 0 18px">Hi ${name || "there"} &#128075;, you're all set. Here's what you need:</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf8ff;border:1px solid #ebe4fb;border-radius:13px;padding:8px 20px">${rows}</table>
    </td></tr>
    ${cta}
    <tr><td align="center" style="padding:16px 34px 0"><p style="font:400 13px Arial,sans-serif;color:#9a97ab;margin:0">&#128206; A calendar invite is attached.</p></td></tr>
    <tr><td style="padding:24px 34px 30px"><div style="border-top:1px solid #eeeaf6;padding-top:16px;font:400 12px Arial,sans-serif;color:#a8a5b8"><b style="color:#7a7790">Vedam School of Technology</b><br/>Pune &middot; Gurugram &nbsp;|&nbsp; <a href="https://vedam.org" style="color:#8A18FF;text-decoration:none;font-weight:700">vedam.org</a></div></td></tr>
  </table></td></tr></table>`;
}

/** Branded shell for campaign emails (admin-composed body inside). */
export function campaignShell(bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;padding:24px 0;background:#f4f2f8"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f2f8"><tr><td align="center">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 30px rgba(43,19,92,.10)">
    <tr><td style="background:linear-gradient(125deg,#2B135C 0%,#5b1ec9 55%,#8A18FF 100%);padding:30px 34px"><div style="font:800 12px Arial,sans-serif;letter-spacing:2.5px;color:#fff;text-transform:uppercase">Vedam School of Technology</div></td></tr>
    <tr><td style="padding:30px 34px;font:400 15px/1.65 Arial,sans-serif;color:#1c1733">${bodyHtml}</td></tr>
    <tr><td style="padding:18px 34px 22px;border-top:1px solid #ece9f3;font:400 12px Arial,sans-serif;color:#7a7790" align="center">Pune &middot; Gurugram &nbsp;|&nbsp; <a href="https://vedam.org" style="color:#8A18FF;text-decoration:none;font-weight:700">vedam.org</a></td></tr>
  </table></td></tr></table></body></html>`;
}

/** Gradient CTA button for transactional emails. */
export function buttonHtml(text: string, url: string): string {
  if (!text || !url) return "";
  return `<div style="text-align:center;margin:22px 0 4px"><a href="${url}" style="display:inline-block;background:linear-gradient(95deg,#F97D03 0%,#8A18FF 100%);color:#fff;text-decoration:none;font:800 15px Arial,sans-serif;padding:14px 34px;border-radius:11px">${text}</a></div>`;
}
