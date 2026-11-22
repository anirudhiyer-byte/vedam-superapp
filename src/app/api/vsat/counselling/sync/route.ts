/**
 * VSAT counselling · "sync now" after admin / admissions save a schedule, move or cancel (0145): the Google Meet
 * and the emails for those students now instead of within 10 minutes (cron). Same rules as the interviews
 * (src/lib/vsat/sync-route.ts).
 */
import { meetingSyncPost } from "@/lib/vsat/sync-route";
import { TRACKS } from "@/lib/vsat/tracks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const preferredRegion = "bom1"; // same region as the Supabase database (Mumbai)

export function POST(req: Request) {
  return meetingSyncPost(req, TRACKS.counselling);
}
