import { ImageResponse } from "next/og";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("c") || "";
  let name = "Vedam Certificate", event = "Vedam School of Technology", kind = "participation";
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (url && anon && id) {
      const supa = createClient(url, anon);
      const { data } = await supa.rpc("verify_certificate", { p_id: id });
      const row = Array.isArray(data) ? data[0] : data;
      if (row?.valid) { name = row.full_name || name; event = row.event_name || event; kind = row.kind || kind; }
    }
  } catch { /* fall back to defaults */ }

  const isWinner = kind === "winner";
  return new ImageResponse(
    (
      <div style={{ height: "100%", width: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: "80px", background: "linear-gradient(125deg,#2B135C 0%,#5b1ec9 55%,#8A18FF 100%)", color: "#fff", fontFamily: "sans-serif" }}>
        <div style={{ fontSize: 26, letterSpacing: 3, color: "#F97D03", fontWeight: 700, textTransform: "uppercase" }}>Vedam School of Technology</div>
        <div style={{ fontSize: 34, marginTop: 28, color: "#ddd0ff" }}>{isWinner ? "🏆 Certificate of Excellence" : "🎓 Certificate of Participation"}</div>
        <div style={{ fontSize: 76, fontWeight: 800, marginTop: 12, lineHeight: 1.05 }}>{name}</div>
        <div style={{ fontSize: 34, marginTop: 20, color: "#eee" }}>{event}</div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
