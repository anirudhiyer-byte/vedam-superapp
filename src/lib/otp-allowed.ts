/** Client helper: ask the server whether another phone OTP may be sent.
 *  Returns false ONLY on an explicit 429 (limit hit). Any other failure
 *  (network, 5xx) returns true — same fail-open behaviour the old client-side
 *  rpc had, so a limiter outage never blocks a genuine login. */
export async function otpAllowed(phoneE164: string): Promise<boolean> {
  try {
    const r = await fetch("/api/auth/otp-allowed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: phoneE164 }),
    });
    if (r.status === 429) return false;
    return true;
  } catch {
    return true;
  }
}
