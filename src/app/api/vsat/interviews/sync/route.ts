/**
 * VSAT interviews · "sync now" after admin / admissions save a schedule, move or cancel (0140).
 * The shared rules (CSRF, login, role, campus filter, time budget) are in src/lib/vsat/sync-route.ts.
 */
import { meetingSyncPost } from "@/lib/vsat/sync-route";
import { TRACKS } from "@/lib/vsat/tracks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const preferredRegion = "bom1"; // same region as the Supabase database (Mumbai)

export function POST(req: Request) {
  return meetingSyncPost(req, TRACKS.interview);
}
