import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  // admin check (role row OR confirmed @vedam.org)
  const { data: roleRow } = await sb.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
  const isAdmin = !!roleRow || (!!user.email?.toLowerCase().endsWith("@vedam.org") && !!user.email_confirmed_at);
  if (!isAdmin) return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ error: "AI is not configured (ANTHROPIC_API_KEY missing in Vercel)." }, { status: 500 });

  const { from, to } = await req.json().catch(() => ({} as { from?: string; to?: string }));
  if (!from || !to) return NextResponse.json({ error: "Missing date range" }, { status: 400 });

  // aggregates only — NO PII leaves the server
  const [daily, bySource, flow, clicks] = await Promise.all([
    sb.rpc("daily_funnel", { p_from: from, p_to: to }),
    sb.rpc("funnel_by_source_page", { p_from: from, p_to: to }),
    sb.rpc("page_flow", { p_from: from, p_to: to }),
    sb.rpc("clicks_summary", { p_from: from, p_to: to }),
  ]);
  const summary = {
    range: { from, to },
    daily_funnel: daily.data,
    funnel_by_source_and_landing_page: bySource.data,
    exit_pages: flow.data,
    top_button_clicks: (clicks.data ?? []).slice(0, 30),
    glossary: {
      products: "Bootcamp (/events/*), CodeSprint (/codesprint*), VSAT (/apply)",
      attempted: "sessions that reached /register",
      registered: "attempted sessions that created an account (partial=phone only, full=completed)",
      funnel: "visitors -> attempted -> registered(partial/full) -> bootcamp/codesprint enrol",
    },
  };

  const prompt = `You are a senior growth & conversion analyst for "Vedam One", a JEE-aspirant super-app (bootcamps, CodeSprint coding course, and VSAT application). Below is AGGREGATE funnel data (no personal data) for the selected date range.

DATA:
${JSON.stringify(summary)}

The team's biggest concern is a sharp drop-off from New Visitors to Attempted Registration. Analyse the data and return PRIORITIZED, concrete insights. For EACH insight give:
1. **Finding** (one line, with the specific numbers)
2. **Likely cause** (reason from the data — which source/page/step and why)
3. **Recommended change** (specific: UI/UX, copy, flow, CTA, or tracking fix)
4. **Projected impact** (rough % lift and the reasoning behind the estimate)

Rank by expected impact. Be specific and quantitative, cite the numbers from the data, and avoid generic advice. If the data is too sparse to conclude, say so and state what to track. Keep it tight — 4 to 6 insights max. Use markdown.`;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-5-5", max_tokens: 8000, messages: [{ role: "user", content: prompt }] }),
    });
    const raw = await r.text();
    if (!r.ok) return NextResponse.json({ error: `AI error ${r.status}: ${raw.slice(0, 400)}` }, { status: 502 });
    let j: Record<string, unknown>;
    try { j = JSON.parse(raw); } catch { return NextResponse.json({ error: "Bad AI response: " + raw.slice(0, 300) }, { status: 502 }); }
    const blocks = (j.content as { type: string; text?: string }[] | undefined) ?? [];
    const text = blocks.filter((c) => c.type === "text").map((c) => c.text || "").join("\n").trim();
    if (!text) {
      // tell us exactly why it's empty + whether our data was empty
      const dataCounts = {
        daily: Array.isArray(daily.data) ? daily.data.length : 0,
        by_source_page: Array.isArray(bySource.data) ? bySource.data.length : 0,
        exits: Array.isArray(flow.data) ? flow.data.length : 0,
        clicks: Array.isArray(clicks.data) ? clicks.data.length : 0,
      };
      return NextResponse.json({ error: "Model returned no text.", debug: { stop_reason: j.stop_reason, type: j.type, model: j.model, content_blocks: blocks.length, api_error: j.error, data_row_counts: dataCounts } }, { status: 200 });
    }
    return NextResponse.json({ insights: text });
  } catch (e) {
    return NextResponse.json({ error: "AI request failed: " + String(e) }, { status: 502 });
  }
}
