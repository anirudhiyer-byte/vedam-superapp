import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

/**
 * Zoom webhook: handles URL validation + participant join/leave, writing raw
 * attendance rows keyed by meeting id + participant email. A later
 * zoom_recompute_event() rolls these up into joined/minutes + points.
 * Verifies Zoom's signature with ZOOM_WEBHOOK_SECRET.
 */
export async function POST(req: Request) {
  const secret = process.env.ZOOM_WEBHOOK_SECRET;
  const raw = await req.text();
  let payload: { event?: string; payload?: Record<string, unknown> };
  try { payload = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }

  // Signature check (Zoom: v0=HMAC-SHA256 of `v0:{ts}:{body}`)
  if (secret) {
    const ts = req.headers.get("x-zm-request-timestamp") || "";
    const sig = req.headers.get("x-zm-signature") || "";
    const expected = "v0=" + crypto.createHmac("sha256", secret).update(`v0:${ts}:${raw}`).digest("hex");
    if (!sig || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return new Response("bad signature", { status: 401 });
    }
  }

  // URL validation handshake
  if (payload.event === "endpoint.url_validation") {
    const plainToken = (payload.payload as { plainToken?: string })?.plainToken || "";
    const encryptedToken = secret ? crypto.createHmac("sha256", secret).update(plainToken).digest("hex") : "";
    return Response.json({ plainToken, encryptedToken });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return new Response("ok", { status: 200 });
  const supa = createClient(url, service);

  const obj = (payload.payload as { object?: Record<string, unknown> })?.object || {};
  const meetingId = String((obj as { id?: string | number }).id ?? "");
  const participant = ((obj as { participant?: Record<string, unknown> }).participant) || {};
  const email = String((participant as { email?: string }).email || "").toLowerCase();
  const pname = String((participant as { user_name?: string }).user_name || "");

  // map meeting -> event
  let eventId: string | null = null;
  if (meetingId) {
    const { data: ev } = await supa.from("events").select("id").eq("zoom_meeting_id", meetingId).maybeSingle();
    eventId = ev?.id ?? null;
  }

  if (payload.event === "meeting.participant_joined") {
    await supa.from("zoom_attendance").insert({
      event_id: eventId, meeting_id: meetingId, participant_email: email, participant_name: pname,
      join_time: (participant as { join_time?: string }).join_time || new Date().toISOString(), raw: participant,
    });
  } else if (payload.event === "meeting.participant_left") {
    const leave = (participant as { leave_time?: string }).leave_time || new Date().toISOString();
    // close the most recent open row for this participant+meeting
    const { data: open } = await supa.from("zoom_attendance")
      .select("id, join_time").eq("meeting_id", meetingId).eq("participant_email", email)
      .is("leave_time", null).order("id", { ascending: false }).limit(1).maybeSingle();
    if (open) {
      const secs = Math.max(0, Math.round((new Date(leave).getTime() - new Date(open.join_time).getTime()) / 1000));
      await supa.from("zoom_attendance").update({ leave_time: leave, duration_seconds: secs }).eq("id", open.id);
    } else {
      await supa.from("zoom_attendance").insert({ event_id: eventId, meeting_id: meetingId, participant_email: email, participant_name: pname, leave_time: leave, raw: participant });
    }
  }
  return new Response("ok", { status: 200 });
}
