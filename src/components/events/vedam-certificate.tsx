"use client";
import { forwardRef, type CSSProperties } from "react";

/** Certificate of Participation — 1123x793 canvas, 1:1 with the source art. */
const CW = 1123, CH = 793;
const PURPLE = "#8A18FF", DARK = "#402A67", MUTED = "#9C90B0", RULE = "#000000";
const NS_FONT = "var(--font-nunito), system-ui, 'Segoe UI', Roboto, Arial, sans-serif";
const PR_FONT = "var(--font-prompt), system-ui, 'Segoe UI', Roboto, Arial, sans-serif";
const NS = { font: NS_FONT, asc: 1.011, desc: 0.353 };
const PR = { font: PR_FONT, asc: 1.09, desc: 0.422 };

type M = { font: string; asc: number; desc: number };
function textStyle(m: M, size: number, baseline: number, weight: number, color: string, extra?: CSSProperties): CSSProperties {
  return { position: "absolute", top: baseline - m.asc * size, fontFamily: m.font, fontSize: size, lineHeight: `${(m.asc + m.desc) * size}px`, fontWeight: weight, color, whiteSpace: "nowrap", ...extra };
}
const centred = (m: M, size: number, baseline: number, weight: number, color: string, extra?: CSSProperties): CSSProperties =>
  textStyle(m, size, baseline, weight, color, { left: 0, right: 0, textAlign: "center", ...extra });
const column = (m: M, size: number, baseline: number, weight: number, color: string, centerX: number, width = 260, extra?: CSSProperties): CSSProperties =>
  textStyle(m, size, baseline, weight, color, { left: centerX - width / 2, width, textAlign: "center", ...extra });

function fmtDate(d?: string | Date): string {
  if (!d) return "";
  if (typeof d === "string") { const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`; }
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}
const bootcampLabel = (name?: string, dedupe = true) => {
  let n = String(name || "").trim();
  if (dedupe) n = n.replace(/\s*bootcamp\s*$/i, "").trim();
  return n;
};

type Props = {
  fullName?: string; bootcampName?: string; issueDate?: string | Date; certificateId?: string;
  qrDataUrl?: string; showQr?: boolean; qrCaption?: string; scale?: number;
  kind?: "participation" | "winner" | "completion";
  position?: string | null;
};

const VedamCertificate = forwardRef<HTMLDivElement, Props>(function VedamCertificate(
  { fullName, bootcampName, issueDate, certificateId, qrDataUrl = "", showQr = true, qrCaption = "Scan to verify", scale = 1, kind = "participation", position = null }, ref
) {
  const name = fullName || "";
  const camp = bootcampLabel(bootcampName);
  const dateStr = fmtDate(issueDate);

  const cert = (
    <div ref={ref} style={{ position: "relative", width: CW, height: CH, overflow: "hidden", fontFamily: NS_FONT, color: DARK, boxSizing: "border-box", userSelect: "none", background: "#fff" }}>
      {/* eslint-disable @next/next/no-img-element */}
      <img src="/cert-bg.png" alt="" style={{ position: "absolute", left: 0, top: 0, width: CW, height: CH, display: "block" }} />
      <img src="/vedam-logo.png" alt="Vedam" style={{ position: "absolute", left: 477.1, top: 93.1, height: 54.9, width: "auto", display: "block" }} />
      {kind === "winner" ? (
        <div style={{ position: "absolute", right: 60, top: 60, background: "linear-gradient(120deg,#B8860B,#F5C542)", color: "#3a2a00", fontWeight: 800, fontSize: 14, letterSpacing: 1.5, padding: "6px 16px", borderRadius: 999 }}>
          {position === "1st" ? "🥇 1ST PLACE" : position === "2nd" ? "🥈 2ND PLACE" : position === "3rd" ? "🥉 3RD PLACE" : "🏆 WINNER"}
        </div>
      ) : null}
      <div style={centred(NS, kind === "winner" ? 40 : 42.09, 219, 800, kind === "winner" ? "#B8860B" : PURPLE)}>{kind === "winner" ? "Certificate of Excellence" : kind === "completion" ? "Certificate of Completion" : "Certificate of Participation"}</div>
      {kind === "winner" && position ? <div style={centred(NS, 20, 255, 700, "#B8860B")}>{position === "1st" ? "First Place" : position === "2nd" ? "Second Place" : position === "3rd" ? "Third Place" : position}</div> : null}
      <div style={centred(NS, 25.25, 277, 400, DARK)}>{kind === "winner" ? "IS PROUDLY AWARDED TO" : "IS PROUDLY PRESENTED TO"}</div>
      <div style={centred(NS, 67.35, 383, 400, PURPLE, { paddingLeft: 90, paddingRight: 90, overflow: "hidden", textOverflow: "ellipsis" })}>{name}</div>
      <div style={centred(NS, 18.24, 451, 400, DARK)}>{kind === "winner" ? `For winning the ${camp} Bootcamp conducted by` : kind === "completion" ? "For successfully completing" : `For participating in the ${camp} Bootcamp conducted by`}</div>
      <div style={centred(NS, 18.24, 478, 400, kind === "completion" ? PURPLE : DARK)}>{kind === "completion" ? camp : "Vedam School of Technology."}</div>
      <img src="/cert-signature.png" alt="Signature" style={{ position: "absolute", left: 270.9, top: 528, width: 147.1, height: 109.1, display: "block" }} />
      <div style={{ position: "absolute", left: 270, top: 618, width: 152, height: 1, background: RULE }} />
      <div style={column(PR, 12.62, 638, 400, MUTED, 344.5)}>Senior Vice President</div>
      <div style={column(PR, 12.62, 657, 400, MUTED, 344.5)}>Vedam School of Technology</div>
      <img src="/cert-seal.png" alt="" style={{ position: "absolute", left: 498.9, top: 534.9, width: 126.1, height: 126.1, display: "block" }} />
      <div style={{ position: "absolute", left: 0, right: 0, top: 553, height: 16, display: "flex", alignItems: "center", justifyContent: "center", gap: 5.8, color: "#fff", fontSize: 10.5, lineHeight: 1 }}>
        <span>★</span><span>★</span><span>★</span>
      </div>
      <div style={centred(PR, 11.22, 594, 400, "#fff")}>VERIFIED</div>
      <div style={centred(PR, 11.22, 611, 400, "#fff")}>CERTIFICATE</div>
      <div style={column(PR, 16.83, 604, 400, DARK, 777.3)}>{dateStr}</div>
      <div style={{ position: "absolute", left: 702.9, top: 618, width: 152, height: 1, background: RULE }} />
      <div style={column(PR, 12.62, 638, 400, MUTED, 777.3)}>Certificate</div>
      <div style={column(PR, 12.62, 657, 400, MUTED, 777.3)}>Issuing Date</div>
      <div style={centred(PR, 18.24, 699, 400, DARK)}>CERTIFICATE ID</div>
      <div style={centred(PR, 14.03, 721, 400, MUTED)}>{certificateId}</div>
      {showQr && qrDataUrl ? (
        <>
          <img src={qrDataUrl} alt="Verification QR" style={{ position: "absolute", left: 932.1, top: 534.9, width: 92, height: 92, display: "block" }} />
          <div style={column(PR, 12.62, 657, 400, MUTED, 978.1, 200)}>{qrCaption}</div>
        </>
      ) : null}
      {/* eslint-enable @next/next/no-img-element */}
    </div>
  );

  if (scale === 1) return cert;
  return <div style={{ width: CW * scale, height: CH * scale, overflow: "hidden" }}><div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: CW, height: CH }}>{cert}</div></div>;
});

export default VedamCertificate;
