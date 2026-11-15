/**
 * VSAT · Generate profile (profile analyser, step 6) — staff only.
 *
 * Order: CSRF (same origin) → JSON → login → vsat_profile_start AS THE USER (access check, per-user
 * and per-student limits, run log, the student's fields) → AI call with the server's key → save with
 * the service role (vsat_profile_save), so the stored briefing can only be what the AI returned.
 *
 * Only the selected student's fields go to the AI, only from here (never from the browser). No student
 * data and no AI error text is logged or sent back; the browser only gets an answer code or the briefing.
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { adminDb } from "@/lib/supabase/service";
import { readJsonObject, sameOrigin } from "@/lib/peerpath/book-request";
import { PROFILE_MODEL, buildProfilePrompt, cleanFields } from "@/lib/vsat/profile-prompt";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const preferredRegion = "bom1";

const DB_CODES = new Set(["FORBIDDEN", "NOT_SIGNED_IN", "NEEDS_COUNSELLOR", "RATE_LIMITED", "IN_PROGRESS"]);
const STATUS: Record<string, number> = { FORBIDDEN: 403, NOT_SIGNED_IN: 401, NEEDS_COUNSELLOR: 409, RATE_LIMITED: 429, IN_PROGRESS: 409 };

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ ok: false, code: "FORBIDDEN" }, 403);
  if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) return json({ ok: false, code: "INVALID" }, 415);
  const raw = await readJsonObject(req);
  const appId = raw?.application_id;
  if (!raw || typeof appId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(appId)) return json({ ok: false, code: "INVALID" }, 400);

  const sb = await createClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth?.user) return json({ ok: false, code: "NOT_SIGNED_IN" }, 401);

  const { data: start, error } = await sb.rpc("vsat_profile_start", { p_application_id: appId });
  if (error) {
    const code = DB_CODES.has(error.message) ? error.message : "SERVER";
    return json({ ok: false, code }, STATUS[code] ?? 500);
  }
  const runId = (start as { run_id?: unknown } | null)?.run_id;
  if (typeof runId !== "string") return json({ ok: false, code: "SERVER" }, 500);

  const admin = adminDb();
  const fail = (code: string) => admin.rpc("vsat_profile_fail", { p_run_id: runId, p_code: code }).then(() => undefined, () => undefined);

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    await fail("AI_NOT_CONFIGURED");
    return json({ ok: false, code: "AI_NOT_CONFIGURED" }, 503);
  }

  const prompt = buildProfilePrompt(cleanFields((start as { fields?: unknown }).fields), new Date());
  let text = "";
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: PROFILE_MODEL, max_tokens: 2000, messages: [{ role: "user", content: prompt }] }),
      signal: AbortSignal.timeout(50_000),
    });
    if (r.ok) {
      const j = (await r.json()) as { content?: { type: string; text?: string }[] };
      text = (j.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n").trim();
    }
  } catch {
    text = "";
  }
  if (!text) {
    await fail("AI_ERROR");
    return json({ ok: false, code: "AI_ERROR" }, 502);
  }

  const { data: saved, error: saveErr } = await admin.rpc("vsat_profile_save", { p_run_id: runId, p_text: text.slice(0, 20000), p_model: PROFILE_MODEL });
  if (saveErr) {
    await fail("SAVE_FAILED");
    return json({ ok: false, code: "SERVER" }, 500);
  }
  return json({ ok: true, text: text.slice(0, 20000), generated_at: (saved as { generated_at?: string } | null)?.generated_at ?? null, model: PROFILE_MODEL });
}
