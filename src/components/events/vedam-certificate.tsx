"use client";
import { forwardRef, type CSSProperties } from "react";

/** Vedam certificate — Figma design (v6). Same props as before so verify/view/
 *  download/animations keep working; only the visual changed. 1123x793 canvas. */
const CW = 1123, CH = 793;
const NS = "var(--font-nunito), var(--font-inter), system-ui, Arial, sans-serif";
const PLAY = "var(--font-playfair), Georgia, 'Times New Roman', serif";

// static parts from /public: polka texture, Vedam logo, signature, verified watermark
const A = { polka: "/cert-polka.webp", logo: "/vedam-logo.png", sign: "/cert-signature.png", mark: "/verified-watermark.webp" };
// left ribbon inset from the card edge, and ribbon width
const RIB_LEFT = 40, RIB_W = 108, CARD_L = 156;   // content starts right of the ribbon

type Props = { fullName?: string; bootcampName?: string; issueDate?: string | Date; certificateId?: string; qrDataUrl?: string; showQr?: boolean; qrCaption?: string; scale?: number; kind?: "participation" | "winner" | "completion"; position?: string | null };

const fmtDate = (d?: string | Date) => {
  if (!d) return "";
  const dt = d instanceof Date ? d : new Date(d); if (isNaN(dt.getTime())) return String(d);
  const p = (n: number) => String(n).padStart(2, "0"); return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
};

const VedamCertificate = forwardRef<HTMLDivElement, Props>(function VedamCertificate(
  { fullName, bootcampName, issueDate, certificateId, qrDataUrl = "", showQr = true, qrCaption = "Scan to verify", scale = 1, kind = "participation", position = null }, ref) {
  const name = fullName || "Your Name";
  const isCS = kind === "completion";
  const winner = kind === "winner";

  const grad = isCS ? "linear-gradient(162deg,#FFB41F 2%,#FD5300 86%)" : "linear-gradient(174deg,#00CFE5 5%,#C200DB 96%)";
  const frameGrad = isCS ? "linear-gradient(118deg,#FFB41F 26%,#FD5300 129%)" : "linear-gradient(118deg,#00CFE5 26%,#C200DB 129%)";
  const accent = isCS ? "#FD7B03" : "#7b5cff";
  const title2 = isCS ? "COMPLETION" : "PARTICIPATION";
  const course = (bootcampName || "").replace(/\s+in CodeSprint$/i, "") || "Name of Course";
  const bodyLine = isCS
    ? (<>for successfully Completing&nbsp;<b style={{ fontWeight: 700, color: "#2b2b2b" }}>{course}</b></>)
    : (<>for successfully participating in&nbsp;<b style={{ fontWeight: 700, color: "#2b2b2b" }}>{course}</b></>);

  // heading/logo centre over the area to the RIGHT of the ribbon
  const contentCenter: CSSProperties = { position: "absolute", left: CARD_L, right: 0, display: "flex", flexDirection: "column", alignItems: "center" };
  // chevron-ribbon accent beside the sub-title
  const chip = (flip = false): CSSProperties => ({ width: 60, height: 22, background: grad, clipPath: "polygon(0 0,100% 0,86% 50%,100% 100%,0 100%)", transform: flip ? "scaleX(-1)" : "none" });

  const cert = (
    <div ref={ref} style={{ position: "relative", width: CW, height: CH, boxSizing: "border-box", padding: 12, borderRadius: 22, background: frameGrad, overflow: "hidden", userSelect: "none", fontFamily: NS }}>
      <div style={{ position: "relative", width: "100%", height: "100%", background: "#fff", borderRadius: 16, overflow: "hidden" }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={A.polka} alt="" style={{ position: "absolute", right: -55, top: -120, width: 760, height: 760, objectFit: "cover", opacity: 0.12, pointerEvents: "none" }} />
        {/* polka texture */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={A.polka} alt="" style={{ position: "absolute", right: -55, top: -120, width: 760, height: 760, objectFit: "cover", opacity: 0.2, pointerEvents: "none" }} />

        {/* LEFT ribbons — both notch INWARD toward the QR (flat outer edges) */}
        <div style={{ position: "absolute", left: RIB_LEFT, top: 0, width: RIB_W, height: 328, background: grad, clipPath: "polygon(0 0, 100% 0, 100% 100%, 50% 84%, 0 100%)" }} />
        <div style={{ position: "absolute", left: RIB_LEFT, bottom: 0, width: RIB_W, height: 308, background: grad, clipPath: "polygon(0 0, 50% 16%, 100% 0, 100% 100%, 0 100%)" }} />
        {/* QR centered in the banner gap */}
        {showQr && (
          <div style={{ position: "absolute", left: RIB_LEFT, top: 348, width: RIB_W, textAlign: "center" }}>
            {qrDataUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={qrDataUrl} alt="Verify QR" style={{ width: 96, height: 96, margin: "0 auto", display: "block", background: "#fff", padding: 4, borderRadius: 6 }} />
              : <div style={{ width: 96, height: 96, margin: "0 auto", background: "#eee", borderRadius: 6 }} />}
            <div style={{ marginTop: 4, fontSize: 15, color: "#7a7a7a", letterSpacing: "-0.75px" }}>{qrCaption}</div>
          </div>
        )}

        {/* Vedam logo — centered above the heading */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={A.logo} alt="Vedam" style={{ position: "absolute", left: CARD_L, right: 0, top: 34, height: 48, margin: "0 auto", width: "auto", maxWidth: 220, display: "block" }} />

        {/* HEADING — centered */}
        <div style={{ ...contentCenter, top: 116 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
            <span style={{ fontWeight: 500, fontSize: 46, letterSpacing: "-2.3px", color: "#1e1e1e", textTransform: "uppercase" }}>Certificate</span>
            <span style={{ fontFamily: PLAY, fontStyle: "italic", fontWeight: 500, fontSize: 46, letterSpacing: "-2.3px", color: "#1e1e1e" }}>of</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 8 }}>
            <span style={chip(true)} />
            <span style={{ fontWeight: 300, fontSize: 33, letterSpacing: "-1.98px", color: "#1e1e1e", textTransform: "uppercase" }}>{title2}</span>
            <span style={chip(false)} />
          </div>
        </div>

        {/* NAME + body — centered */}
        <div style={{ ...contentCenter, top: 300 }}>
          <div style={{ fontWeight: 300, fontSize: 18, color: "#2b2b2b", letterSpacing: "-0.9px" }}>Proudly presented to</div>
          <div style={{ marginTop: 18, fontFamily: PLAY, fontStyle: "italic", fontWeight: 500, fontSize: 50, letterSpacing: "-2px", color: accent,
            backgroundImage: grad, WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent" as CSSProperties["WebkitTextFillColor"] }}>{name}</div>
          <div style={{ marginTop: 26, fontWeight: 300, fontSize: 22, color: "#2b2b2b", letterSpacing: "-1px" }}>{bodyLine}</div>
          {isCS
            ? <div style={{ marginTop: 10, fontWeight: 700, fontSize: 25, letterSpacing: "-1.25px", textTransform: "uppercase", color: accent,
                backgroundImage: grad, WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent" as CSSProperties["WebkitTextFillColor"] }}>
                <span style={{ fontWeight: 800 }}>Code</span><span style={{ fontWeight: 300 }}>sprint</span></div>
            : <div style={{ marginTop: 8, fontWeight: 300, fontSize: 20, color: "#2b2b2b" }}>conducted by Vedam School of Technology</div>}
        </div>

        {winner && <div style={{ position: "absolute", right: 40, top: 300, fontWeight: 800, fontSize: 14, color: accent }}>{position === "1st" ? "🥇 1ST" : position === "2nd" ? "🥈 2ND" : position === "3rd" ? "🥉 3RD" : "🏆 WINNER"}</div>}

        {/* signature — bottom left, right of ribbon */}
        <div style={{ position: "absolute", left: CARD_L + 20, bottom: 44 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={A.sign} alt="" style={{ height: 60, width: "auto", transform: "rotate(-4deg)", marginBottom: 2 }} />
          <div style={{ fontWeight: 600, fontSize: 15, color: "#2b2b2b", letterSpacing: "-0.75px" }}>Chandan Mathur</div>
          <div style={{ fontWeight: 400, fontSize: 15, color: "#7a7a7a", letterSpacing: "-1px" }}>SVP, Vedam School of Technology</div>
        </div>

        {/* verified watermark — bottom right (from /public/verified-watermark.webp) */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={A.mark} alt="" style={{ position: "absolute", right: 70, bottom: 50, width: 120, height: 120, opacity: 0.18, pointerEvents: "none", objectFit: "contain" }} />

        {certificateId && <div style={{ position: "absolute", left: CARD_L, right: 0, bottom: 16, textAlign: "center", fontSize: 10, color: "#c2c2c2", letterSpacing: 1 }}>{certificateId}{issueDate ? ` · ${fmtDate(issueDate)}` : ""}</div>}
      </div>
    </div>
  );

  if (scale === 1) return cert;
  return <div style={{ width: CW * scale, height: CH * scale, overflow: "hidden" }}><div style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}>{cert}</div></div>;
});

export default VedamCertificate;
