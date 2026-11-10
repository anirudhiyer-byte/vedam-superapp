/**
 * Elevate outbound webhook — drain cron.
 * Signs + POSTs pending outbox events to Elevate, with retry/backoff.
 * Does nothing until ELEVATE_WEBHOOK_URL / ELEVATE_WEBHOOK_SECRET are set.
 */
import { NextResponse } from "next/server";
import { drainElevateOutbox } from "@/lib/elevate/drain";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const preferredRegion = "bom1"; // same region as the Supabase database

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("unauthorized", { status: 401 });
  }
  const result = await drainElevateOutbox();
  return NextResponse.json(result);
}
