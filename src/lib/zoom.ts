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
