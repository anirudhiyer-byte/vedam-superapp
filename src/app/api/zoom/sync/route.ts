import { createClient } from "@supabase/supabase-js";
import { zoomToken, reconcileAttendance } from "@/lib/zoom";

export const runtime = "nodejs";

/** Admin: pull Zoom's authoritative attendance report for an event and finalize. */
export async function POST(req: Request) {
  try {
    const { eventId, accessToken } = (await req.json()) as { eventId: string; accessToken?: string };
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !anon || !svc || !accessToken || !eventId) return Response.json({ ok: false, error: "Not authorized" }, { status: 401 });

    // verify caller is an admin
    const asUser = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${accessToken}` } } });
    const { data: isAdmin } = await asUser.rpc("is_admin");
    if (!isAdmin) return Response.json({ ok: false, error: "Admins only" }, { status: 403 });

    const svcClient = createClient(url, svc);
    const { data: ev } = await svcClient.from("events").select("zoom_meeting_id").eq("id", eventId).maybeSingle();
    if (!ev?.zoom_meeting_id) return Response.json({ ok: false, error: "No Zoom meeting on this event" }, { status: 200 });

    const token = await zoomToken();
    if (!token) return Response.json({ ok: false, error: "Zoom not configured" }, { status: 200 });

    const { applied, source } = await reconcileAttendance(svcClient as never, token, eventId, ev.zoom_meeting_id);
    return Response.json({ ok: true, applied, source });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 200 });
  }
}
