/** Admin "Test connection" — sends one test:true event to Elevate and returns its result. */
import { NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/elevate/admin-guard";
import { sendElevateTest } from "@/lib/elevate/drain";

export const dynamic = "force-dynamic";
export const preferredRegion = "bom1";

export async function POST() {
  if (!(await isAdminRequest())) return new Response("forbidden", { status: 403 });
  const result = await sendElevateTest();
  return NextResponse.json(result);
}
