/** Admin — flip the Elevate webhook flag (on/off) from the UI. DB re-checks admin. */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdminRequest } from "@/lib/elevate/admin-guard";

export const dynamic = "force-dynamic";
export const preferredRegion = "bom1";

export async function POST(req: Request) {
  if (!(await isAdminRequest())) return new Response("forbidden", { status: 403 });
  let on = false;
  try {
    const body = (await req.json()) as { on?: unknown };
    on = body?.on === true;
  } catch {
    return NextResponse.json({ ok: false, error: "bad request" }, { status: 400 });
  }
  const sb = await createClient();
  const { data, error } = await sb.rpc("elevate_set_live", { p: { on } });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, result: data });
}
