"use client";
import { forwardRef, type CSSProperties } from "react";
import { parseSlot, fmtParts } from "@/lib/slot";

/** Vedam Xperience Day invite pass — 1000x436 canvas, 1:1 with the source art. */
const CW = 1000, CH = 436;
const PURPLE = "#8A18FF", INDIGO = "#2B135C", INK = "#171423", XPUR = "#7A1FD6";
const NAME_SIZE = 67;
const FONT = "var(--font-nunito), system-ui, 'Segoe UI', Roboto, Arial, sans-serif";

const firstTwoWords = (name?: string) => {
  const w = String(name || "").trim().split(/\s+/).filter(Boolean);
  return w.length === 0 ? "Guest" : w.slice(0, 2).join(" ");
};

const sideStripe = (side: "left" | "right"): CSSProperties => ({
  position: "absolute", top: 0, [side]: 0, width: 36, height: CH, background: INDIGO, zIndex: 4, overflow: "hidden",
});
const sideStripeInner: CSSProperties = {
  position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%) rotate(-90deg)",
  transformOrigin: "center center", whiteSpace: "nowrap", color: "rgba(255,255,255,0.42)", fontSize: 12, fontWeight: 600, letterSpacing: 1,
};

type Props = {
  fullName?: string; slot?: string;
  eventDate?: { day: string; month: string; weekday: string };
  scale?: number;
};

const InvitePass = forwardRef<HTMLDivElement, Props>(function InvitePass(
  { fullName, slot, eventDate = { day: "25", month: "JULY", weekday: "SAT" }, scale = 1 }, ref
) {
  const parsed = parseSlot(slot);
  const startP = fmtParts(parsed.startMin);
  const endP = fmtParts(parsed.endMin);
  const dateDay = parsed.date?.day || eventDate.day;
  const dateMonth = parsed.date?.month || eventDate.month;
  const dateWeekday = parsed.date?.weekday || eventDate.weekday;
  const displayName = firstTwoWords(fullName);
  const railText = Array(9).fill("Vedam Experience Day").join("\u00A0\u00A0\u00A0\u00A0");

  const pass = (
    <div ref={ref} style={{ position: "relative", width: CW, height: CH, background: "#fff", overflow: "hidden", fontFamily: FONT, color: INK, boxSizing: "border-box", userSelect: "none" }}>
      <div style={sideStripe("left")}><div style={sideStripeInner}>{railText}</div></div>
      <div style={sideStripe("right")}><div style={sideStripeInner}>{railText}</div></div>
      <div style={{ position: "absolute", left: 36, top: 26, bottom: 18, width: 82, background: "#000", zIndex: 3 }}>
        <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%) rotate(-90deg)", transformOrigin: "center center", whiteSpace: "nowrap", color: "#fff", fontWeight: 800, fontSize: 30, letterSpacing: 1.5 }}>You Are Invited</div>
      </div>
      <div style={{ position: "absolute", left: 118, right: 36, top: 188, bottom: 0, background: PURPLE, zIndex: 1 }} />
      <div style={{ position: "absolute", left: 150, top: 0, right: 60, height: 188, display: "flex", alignItems: "center", zIndex: 2 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/vedam-logo.png" alt="Vedam" style={{ height: 66, width: "auto", display: "block" }} />
        <div style={{ width: 2, height: 74, background: "#D9D2E6", margin: "0 26px" }} />
        <div style={{ display: "flex", alignItems: "baseline", fontWeight: 800, fontSize: 42, letterSpacing: 0.5, lineHeight: 1 }}>
          <span style={{ color: XPUR }}>X</span><span style={{ color: INK }}>PERIENCE&nbsp;DAY</span>
        </div>
      </div>
      <div style={{ position: "absolute", left: 150, top: 200, right: 70, height: 104, display: "flex", alignItems: "center", zIndex: 2 }}>
        <div style={{ color: "#fff", fontWeight: 700, fontSize: NAME_SIZE, lineHeight: 1, width: "100%", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{displayName}</div>
      </div>
      <div style={{ position: "absolute", left: 150, right: 53, top: 325, height: 100, zIndex: 2, display: "flex", alignItems: "center" }}>
        <div style={{ color: "#fff", fontWeight: 700, fontSize: NAME_SIZE, lineHeight: 1, whiteSpace: "nowrap", flex: "0 0 auto" }}>Your Slot</div>
        <div style={{ marginLeft: 26, flex: "0 0 auto", width: 150, height: 84, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: INDIGO, borderRadius: 10 }}>
          <div style={{ color: "#fff", fontWeight: 800, fontSize: 58, lineHeight: 1 }}>{dateDay}</div>
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
            <span style={{ color: "#fff", fontWeight: 700, fontSize: 19 }}>{dateMonth}</span>
            <span style={{ color: "rgba(255,255,255,0.85)", fontWeight: 600, fontSize: 18, marginTop: 3 }}>{dateWeekday}</span>
          </div>
        </div>
        <div style={{ marginLeft: 6, flex: "0 0 auto", width: 148, height: 84, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: INDIGO, borderRadius: 10 }}>
          <div style={{ color: "#fff", lineHeight: 1, whiteSpace: "nowrap" }}>
            <span style={{ fontWeight: 800, fontSize: 20 }}>{startP.time || "\u2014"}</span>
            {startP.ampm ? <span style={{ fontWeight: 600, fontSize: 14, marginLeft: 3 }}>{startP.ampm}</span> : null}
          </div>
          <div style={{ color: "rgba(255,255,255,0.85)", fontWeight: 500, fontSize: 13, margin: "3px 0" }}>to</div>
          <div style={{ color: "#fff", lineHeight: 1, whiteSpace: "nowrap" }}>
            <span style={{ fontWeight: 800, fontSize: 20 }}>{endP.time || "\u2014"}</span>
            {endP.ampm ? <span style={{ fontWeight: 600, fontSize: 14, marginLeft: 3 }}>{endP.ampm}</span> : null}
          </div>
        </div>
      </div>
    </div>
  );

  if (scale === 1) return pass;
  return <div style={{ width: CW * scale, height: CH * scale, overflow: "hidden" }}><div style={{ transform: `scale(${scale})`, transformOrigin: "top left", width: CW, height: CH }}>{pass}</div></div>;
});

export default InvitePass;
