/** Admin — Elevate outbox queue stats (counts by state + flag + config presence). */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdminRequest } from "@/lib/elevate/admin-guard";

export const dynamic = "force-dynamic";
export const preferredRegion = "bom1";

export async function GET() {
  if (!(await isAdminRequest())) return new Response("forbidden", { status: 403 });
  const sb = await createClient();
  const { data, error } = await sb.rpc("elevate_outbox_stats");
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({
    ok: true,
    stats: data,
    configured: !!process.env.ELEVATE_WEBHOOK_URL && !!process.env.ELEVATE_WEBHOOK_SECRET,
  });
}
