/** Zoom Server-to-Server OAuth client (server-only). */

export async function zoomToken(): Promise<string | null> {
  const acc = process.env.ZOOM_ACCOUNT_ID, id = process.env.ZOOM_CLIENT_ID, sec = process.env.ZOOM_CLIENT_SECRET;
  if (!acc || !id || !sec) return null;
  const basic = Buffer.from(`${id}:${sec}`).toString("base64");
  const res = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${acc}`, {
    method: "POST", headers: { Authorization: `Basic ${basic}` },
  });
  if (!res.ok) return null;
  const j = await res.json().catch(() => ({}));
  return j.access_token || null;
}

/** Register an attendee to a meeting by email → returns their personal join URL. */
export async function addMeetingRegistrant(
  token: string, meetingId: string, email: string, firstName: string, lastName: string
): Promise<{ join_url?: string; error?: string }> {
  const res = await fetch(`https://api.zoom.us/v2/meetings/${meetingId}/registrants`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, first_name: firstName || email.split("@")[0], last_name: lastName || "." }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) return { error: j.message || `Zoom error ${res.status}` };
  return { join_url: j.join_url };
}

/* ---- Authoritative attendance reconciliation (report pull) ---- */

function encodeMeetingId(id: string): string {
  // Zoom UUIDs containing '/' or starting with '/' must be double-encoded.
  return /\/|^\//.test(id) ? encodeURIComponent(encodeURIComponent(id)) : encodeURIComponent(id);
}

export type ReportParticipant = {
  email: string; name: string; duration: number; join_time?: string; leave_time?: string;
};

/** Pull the authoritative participant report for a past meeting (needs report:read:admin). */
export async function getMeetingReport(token: string, meetingId: string): Promise<ReportParticipant[]> {
  const out: ReportParticipant[] = [];
  let next = "";
  do {
    const url = `https://api.zoom.us/v2/report/meetings/${encodeMeetingId(meetingId)}/participants?page_size=300${next ? `&next_page_token=${next}` : ""}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) break;
    const j = await res.json();
    for (const p of (j.participants || []) as Record<string, unknown>[]) {
      out.push({
        email: String(p.user_email || p.email || "").toLowerCase(),
        name: String(p.name || ""),
        duration: Number(p.duration || 0),
        join_time: p.join_time as string | undefined,
        leave_time: p.leave_time as string | undefined,
      });
    }
    next = j.next_page_token || "";
  } while (next);
  return out;
}

/**
 * Reconcile an event's attendance from Zoom's authoritative report, then finalize.
 * Only replaces webhook-collected rows if the report actually returned data (Zoom's
 * report can lag a few minutes after a meeting ends), so we never lose good data.
 * `supa` must be a service-role client. Returns the participant count applied.
 */
export async function reconcileAttendance(
  supa: { from: (t: string) => any; rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown> }, // eslint-disable-line @typescript-eslint/no-explicit-any
  token: string,
  eventId: string,
  meetingId: string
): Promise<{ applied: number; source: "report" | "webhook" }> {
  const participants = await getMeetingReport(token, meetingId);
  let source: "report" | "webhook" = "webhook";
  if (participants.length > 0) {
    await supa.from("zoom_attendance").delete().eq("event_id", eventId);
    await supa.from("zoom_attendance").insert(
      participants.map((p) => ({
        event_id: eventId, meeting_id: String(meetingId), participant_email: p.email,
        participant_name: p.name, duration_seconds: Math.round(p.duration),
        join_time: p.join_time ?? null, leave_time: p.leave_time ?? null, raw: p,
      }))
    );
    source = "report";
  }
  await supa.rpc("zoom_finalize_event", { p_event_id: eventId });
  return { applied: participants.length, source };
}
