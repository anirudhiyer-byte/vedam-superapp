"use client";
import { forwardRef, type CSSProperties } from "react";

/** Vedam certificate — drawn in CSS/SVG (canvas-safe for html2canvas). 1123x793. */
const CW = 1123, CH = 793;
const PURPLE = "#8A18FF", DARK = "#402A67", MUTED = "#9C90B0";
const NS = "var(--font-nunito), system-ui, 'Segoe UI', Arial, sans-serif";
const OUT = "var(--font-outfit), var(--font-nunito), system-ui, Arial, sans-serif";
const PR = "var(--font-prompt), var(--font-nunito), system-ui, Arial, sans-serif";

// canvas-safe "metallic": solid rich colour + beveled highlight/shadow (no gradient-clip).
const goldText: CSSProperties = { color: "#C08A0C", textShadow: "0 1px 0 rgba(255,246,207,.85), 0 2px 3px rgba(120,80,0,.32)" };
const violetText: CSSProperties = { color: "#7B1FD6", textShadow: "0 1px 0 rgba(255,255,255,.55), 0 2px 3px rgba(90,20,180,.28)" };

const fmtDate = (d?: string | Date) => {
  if (!d) return "";
  if (typeof d === "string") { const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`; }
  const dt = d instanceof Date ? d : new Date(d); if (isNaN(dt.getTime())) return String(d);
  const p = (n: number) => String(n).padStart(2, "0"); return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
};
const camp = (n?: string) => String(n || "").trim().replace(/\s*bootcamp\s*$/i, "").trim();

type Props = { fullName?: string; bootcampName?: string; issueDate?: string | Date; certificateId?: string; qrDataUrl?: string; showQr?: boolean; qrCaption?: string; scale?: number; kind?: "participation" | "winner" | "completion"; position?: string | null };

const VedamCertificate = forwardRef<HTMLDivElement, Props>(function VedamCertificate(
  { fullName, bootcampName, issueDate, certificateId, qrDataUrl = "", showQr = true, qrCaption = "Scan to verify", scale = 1, kind = "participation", position = null }, ref) {
  const name = fullName || "";
  const c = camp(bootcampName);
  const dateStr = fmtDate(issueDate);
  const winner = kind === "winner";
  const posWord = position === "1st" ? "First Place" : position === "2nd" ? "Second Place" : position === "3rd" ? "Third Place" : null;
  const posBadge = position === "1st" ? "🥇 1ST PLACE" : position === "2nd" ? "🥈 2ND PLACE" : position === "3rd" ? "🥉 3RD PLACE" : "🏆 WINNER";
  const title = winner ? "Certificate of Excellence" : kind === "completion" ? "Certificate of Completion" : "Certificate of Participation";

  const body = winner
    ? <>For securing <b style={goldText}>{posWord || "the win"}</b> in the {c} Bootcamp conducted by Vedam School of Technology.</>
    : kind === "completion"
      ? <>For successfully completing <b style={{ ...violetText, fontWeight: 800 }}>{c}</b>.</>
      : <>For participating in the {c} Bootcamp conducted by Vedam School of Technology.</>;

  const cert = (
    <div ref={ref} style={{ width: CW, height: CH, boxSizing: "border-box", padding: 8, borderRadius: 20,
      background: "linear-gradient(120deg,#F97D03,#ff8f4d 24%,#e85fb0 60%,#8A18FF)", overflow: "hidden", userSelect: "none", fontFamily: NS }}>
      <div style={{ position: "relative", width: "100%", height: "100%", background: "#fff", borderRadius: 13, overflow: "hidden" }}>
        {/* patterned background @ ~25% */}
        <div style={{ position: "absolute", inset: 0, opacity: 0.25, pointerEvents: "none",
          backgroundImage: "radial-gradient(closest-side at 12% 88%, rgba(249,125,3,.5), transparent 70%), radial-gradient(closest-side at 88% 12%, rgba(138,24,255,.45), transparent 70%), radial-gradient(rgba(43,19,92,.5) 1px, transparent 1.2px)",
          backgroundSize: "auto, auto, 22px 22px" }} />

        {/* cert id (top-left) + QR below */}
        <div style={{ position: "absolute", top: 34, left: 40 }}>
          <div style={{ fontFamily: PR, fontSize: 11, letterSpacing: 1, color: "#b8b0cc", textTransform: "uppercase" }}>Certificate ID</div>
          <div style={{ fontFamily: PR, fontSize: 11, color: "#c3bcd6", marginTop: 2, maxWidth: 220, wordBreak: "break-all" }}>{certificateId}</div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {showQr && qrDataUrl ? <><img src={qrDataUrl} alt="Verify" style={{ width: 78, height: 78, display: "block", marginTop: 12 }} /><div style={{ fontFamily: PR, fontSize: 10, color: "#a49cbe", marginTop: 4 }}>{qrCaption}</div></> : null}
        </div>

        {/* position badge (top-right) */}
        {winner ? <div style={{ position: "absolute", top: 34, right: 40, fontFamily: OUT, fontWeight: 800, fontSize: 15, letterSpacing: 1, color: "#3a2200", padding: "6px 16px", borderRadius: 999,
          background: "linear-gradient(180deg,#ffe9a8,#F5C542 42%,#D69A0B 62%,#b8790a)", boxShadow: "inset 0 1px 1px rgba(255,255,255,.7), inset 0 -1px 2px rgba(120,70,0,.4), 0 3px 8px -3px rgba(184,134,11,.6)" }}>{posBadge}</div> : null}

        {/* center content */}
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 74 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/vedam-logo.png?v=2" alt="Vedam" style={{ height: 50, width: "auto", display: "block" }} />
          <div style={{ fontFamily: OUT, fontWeight: 800, fontSize: 50, marginTop: 26, textAlign: "center", ...(winner ? goldText : { color: PURPLE }) }}>{title}</div>
          <div style={{ fontFamily: NS, fontWeight: 700, letterSpacing: 6, fontSize: 22, color: DARK, marginTop: 20 }}>{winner ? "IS PROUDLY AWARDED TO" : "IS PROUDLY PRESENTED TO"}</div>
          <div style={{ fontFamily: OUT, fontWeight: 500, fontSize: 68, marginTop: 22, textAlign: "center", padding: "0 90px", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", ...violetText }}>{name}</div>
          <div style={{ fontFamily: NS, fontSize: 19, color: DARK, marginTop: 26, textAlign: "center", maxWidth: 720, lineHeight: 1.55 }}>{body}</div>
        </div>

        {/* footer: signature · seal · date (equally spaced, centered on one line) */}
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 66, display: "flex", alignItems: "center", justifyContent: "space-around", padding: "0 9%" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/cert-signature.png" alt="Signature" style={{ width: 138, height: "auto", display: "block" }} />
            <div style={{ width: 168, borderTop: "1.5px solid #444", marginTop: 6, paddingTop: 5, fontFamily: PR, fontSize: 12.5, color: "#555", fontWeight: 600 }}>Senior Vice President<br />Vedam School of Technology</div>
          </div>
          {/* CSS seal — clean 3 stars */}
          <div style={{ width: 120, height: 120, borderRadius: "50%", background: "linear-gradient(135deg,#9b6fe6,#7a4fd0)", border: "3px solid #b79aec", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#fff", boxShadow: "0 10px 22px -12px rgba(138,24,255,.6)" }}>
            <div style={{ fontSize: 15, letterSpacing: 4, lineHeight: 1 }}>★★★</div>
            <div style={{ fontFamily: OUT, fontWeight: 800, fontSize: 11.5, letterSpacing: 0.5, marginTop: 8, textAlign: "center", lineHeight: 1.2 }}>VERIFIED<br />CERTIFICATE</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
            <div style={{ fontFamily: PR, fontSize: 22, color: "#222", borderBottom: "1.5px solid #444", paddingBottom: 4 }}>{dateStr}</div>
            <div style={{ fontFamily: PR, fontSize: 12.5, color: "#555", fontWeight: 600, marginTop: 6 }}>Certificate Issuing Date</div>
          </div>
        </div>
      </div>
    </div>
  );

  if (scale === 1) return cert;
  return <div style={{ width: CW * scale, height: CH * scale, overflow: "hidden" }}><div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: CW, height: CH }}>{cert}</div></div>;
});

export default VedamCertificate;
