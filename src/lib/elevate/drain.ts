import type { SupabaseClient } from "@supabase/supabase-js";
import { adminDb } from "./db";
import { postElevate, type ElevateEvent, type ElevateResult } from "./client";
import { classifyHttp, nextRetry, stateForOutcome } from "./outbox";

const BATCH = 100;

type OutboxRow = { id: string; event_id: string; payload: ElevateEvent; attempts: number };

function env() {
  return { url: process.env.ELEVATE_WEBHOOK_URL, secret: process.env.ELEVATE_WEBHOOK_SECRET };
}

/** Drain pending outbox rows: sign + POST one batch, then apply results / backoff. */
export async function drainElevateOutbox(nowMs: number = Date.now()) {
  const { url, secret } = env();
  if (!url || !secret) return { ok: true as const, skipped: "not_configured" };

  const db = adminDb();
  const { data, error } = await db
    .from("elevate_outbox")
    .select("id,event_id,payload,attempts")
    .eq("state", "pending")
    .lte("next_attempt_at", new Date(nowMs).toISOString())
    .order("created_at", { ascending: true })
    .limit(BATCH);
  if (error) return { ok: false as const, error: error.message };
  const rows = (data ?? []) as OutboxRow[];
  if (rows.length === 0) return { ok: true as const, sent: 0 };

  const r = await postElevate(rows.map((x) => x.payload), { url, secret });
  const cls = r.httpStatus === 0 ? "retry" : classifyHttp(r.httpStatus);

  if (cls === "retry") {
    for (const row of rows) await bump(db, row, nowMs, r.error ?? `http ${r.httpStatus}`);
    return { ok: false as const, retry: rows.length, httpStatus: r.httpStatus };
  }
  if (cls === "fatal") {
    const ts = new Date().toISOString();
    for (const row of rows)
      await db.from("elevate_outbox").update({ state: "rejected", last_error: `http ${r.httpStatus}`, last_response: r.raw, updated_at: ts }).eq("id", row.id);
    return { ok: false as const, fatal: rows.length, httpStatus: r.httpStatus };
  }

  // 200 → apply per-event results
  const byId = new Map<string, ElevateResult>(r.results.map((x) => [x.event_id, x]));
  let sent = 0, held = 0, rejected = 0;
  const ts = new Date().toISOString();
  for (const row of rows) {
    const res = byId.get(row.event_id);
    if (!res) { await bump(db, row, nowMs, "missing_result"); continue; }
    const st = stateForOutcome(res.outcome);
    await db.from("elevate_outbox").update({
      state: st, last_outcome: res.outcome, last_response: res, last_error: res.reason ?? null, updated_at: ts,
    }).eq("id", row.id);
    if (st === "sent") sent++; else if (st === "held") held++; else rejected++;
  }
  return { ok: true as const, sent, held, rejected };
}

async function bump(db: SupabaseClient, row: OutboxRow, nowMs: number, err: string) {
  const { dead, delayMs } = nextRetry(row.attempts ?? 0);
  await db.from("elevate_outbox").update({
    attempts: (row.attempts ?? 0) + 1,
    state: dead ? "dead" : "pending",
    next_attempt_at: new Date(nowMs + delayMs).toISOString(),
    last_error: err,
    updated_at: new Date().toISOString(),
  }).eq("id", row.id);
}

/** Admin "Test connection": send one dry-run event (test:true), return Elevate's result. */
export async function sendElevateTest(sample: Partial<ElevateEvent> = {}) {
  const { url, secret } = env();
  if (!url || !secret) return { ok: false as const, error: "ELEVATE_WEBHOOK_URL / ELEVATE_WEBHOOK_SECRET not set" };
  const ev: ElevateEvent = {
    event_id: `test-${Date.now()}`,
    crm_lead_id: "TEST-CONNECTION",
    mobile: "+91 9000000000",
    status: "Lead",
    occurred_at: new Date().toISOString(),
    ...sample,
    test: true,
  };
  const r = await postElevate([ev], { url, secret });
  return { ok: r.httpStatus === 200, httpStatus: r.httpStatus, results: r.results, raw: r.raw, error: r.error };
}
