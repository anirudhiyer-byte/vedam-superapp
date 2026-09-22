import { createClient } from "@supabase/supabase-js";
import { zoomToken, addMeetingRegistrant } from "@/lib/zoom";

export const runtime = "nodejs";

/** Adds the signed-in registrant to the event's Zoom meeting and stores their
 * personal join URL, so only registered emails can join. Best-effort. */
export async function POST(req: Request) {
  try {
    const { eventId, accessToken } = (await req.json()) as { eventId: string; accessToken?: string };
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon || !accessToken || !eventId) return Response.json({ ok: false, error: "Not authorized" }, { status: 401 });

    const supa = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${accessToken}` } } });
    const { data: u } = await supa.auth.getUser(accessToken);
    if (!u?.user) return Response.json({ ok: false, error: "Invalid session" }, { status: 401 });

    const { data: ev } = await supa.from("events").select("zoom_meeting_id, zoom_id").eq("id", eventId).maybeSingle();
    const mid = String((ev as { zoom_meeting_id?: string; zoom_id?: string } | null)?.zoom_meeting_id || (ev as { zoom_id?: string } | null)?.zoom_id || "").replace(/\D/g, "");
    if (!mid) return Response.json({ ok: true, skipped: "no zoom meeting id" });

    const { data: reg } = await supa.from("event_registrations")
      .select("id, user_email, full_name").eq("event_id", eventId).eq("user_id", u.user.id).maybeSingle();
    if (!reg?.user_email) return Response.json({ ok: false, error: "No registration" }, { status: 404 });

    const token = await zoomToken();
    if (!token) return Response.json({ ok: false, error: "Zoom not configured" }, { status: 200 });

    const [first, ...rest] = String(reg.full_name || "").trim().split(/\s+/);
    const { join_url, error } = await addMeetingRegistrant(token, mid, reg.user_email, first || "", rest.join(" "));
    if (error) return Response.json({ ok: false, error }, { status: 200 });

    if (join_url) await supa.from("event_registrations").update({ zoom_join_url: join_url }).eq("id", reg.id);
    return Response.json({ ok: true, join_url });
  } catch (e) {
    return Response.json({ ok: false, error: String((e as Error)?.message || e) }, { status: 200 });
  }
}
