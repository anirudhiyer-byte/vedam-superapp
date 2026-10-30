# 0001 · PeerPath bookings need a login and VSAT eligibility

- **Status:** Accepted (staging). Production: not applied — needs explicit approval.
- **Date:** 30 Oct 2026
- **Owner:** Pawan Rajak
- **Migrations:** 0031 `app_flags`, 0032 `vsat_payments`, 0033 login + VSAT gate, 0034 `pp_my_contact`, 0035 security-review fixes
- **Rollback files:** `supabase/rollback/0031…0035_*_down.sql` (0031–0033 round-trip tested on staging)

## Context

PeerPath ("Talk to a Senior") let anyone book a chat with no login. Ownership of a booking was proved with the email + phone typed at booking time (0029). For launch (December 2026), only students who registered for VSAT **and** paid the VSAT fee may book. The VSAT payment gateway/webhook does not exist yet, and `application_manager.payment_stage_*` could be set by the applicant themselves through `/api/vsat/stage` (finding H-01), so it cannot be trusted as "paid".

## Decision

1. **Booking needs a login.** The booking belongs to `auth.uid()` (`pp_bookings.applicant_user_id`). View, cancel, feedback and "my bookings" check the login. The email + phone proof is removed. Bookings made before this change are admin-only.
2. **The database decides, from `auth.uid()` only.** `pp_book(p jsonb)` checks, in order: login → per-user rate limit (20/hour) → input shape → eligibility → contact details → slot. The request cannot carry name, email, phone or any payment field. **Email and phone come only from the login itself, and only once Supabase Auth has verified them by OTP** (`auth.users.email_confirmed_at` / `phone_confirmed_at`, via `pp_contact_for`). A verified email is **required** (the Google Meet invite goes there); the phone is **optional** (stored when verified, otherwise empty — nothing in PeerPath sends to it), so `pp_bookings.applicant_phone` is nullable since 0035. Values typed into `/apply` or the profile are never used for contact (they could be someone else's), and the profile's `email_verified` / `mobile_verified` flags are not trusted (users can edit their own profile). The name comes from the application, then the profile.
3. **Eligibility** — `pp_vsat_eligible(uid)`, switched by `app_flags.peerpath_eligibility`:
   | Mode | Who can book |
   |---|---|
   | `off` | Nobody — bookings closed (kill switch; also what happens if the flag is missing) |
   | `registered` | Users with an `application_manager` row |
   | `paid` | Users with an `application_manager` row **and** a `vsat_payments` row |

   Admins (same rule as `pp_is_admin`) skip the VSAT part, but not `off`.
4. **"Paid" = a row in `vsat_payments`.** One row per user, write-once (trigger blocks update/delete/truncate), written only by the future payment webhook with the service key. RLS on, no policies, no browser access. `payment_stage_*` no longer means paid anywhere in PeerPath.
5. **Result codes, not errors.** `pp_book` returns `{ ok, code, id? }`: `OK`, `NOT_LOGGED_IN`, `RATE_LIMITED`, `INVALID`, `BOOKING_CLOSED`, `NOT_REGISTERED`, `PAYMENT_PENDING`, `EMAIL_NOT_VERIFIED` (the login has no OTP-verified email; replaced `PHONE_MISSING` on 30 Oct 2026 when the phone became optional), `SLOT_UNAVAILABLE`, `RESCHEDULE_CLOSED`, `LIMIT_REACHED`, `SERVER`. The UI maps each to a popup (`src/lib/peerpath/booking-codes.ts`). Raw database errors are never shown.
6. **Abuse limits.** Private PeerPath limiter (`pp_rate_limits` / `pp_rate_hit`, callable only inside the database and by the service role): 20 booking attempts per user per hour (DB) and 60 per visitor IP per hour (server route, trusted Vercel IP). Every attempt, allowed or blocked, is logged in `pp_book_attempts`; rows older than 90 days are deleted daily (`pp_cleanup_logs`, pg_cron job `peerpath-log-cleanup`). A logged-in user can also call `pp_book` directly through the Supabase API with their own token; that path skips the route's per-IP limit but not the per-user limits (accepted by the owner, 30 Oct 2026 — accounts need phone OTP + captcha).
7. **Double-click safety.** A repeat of the same booking returns the same id; a unique index makes a second confirmed row for the same user + senior + time impossible.
8. **H-01 (payment fields only).** `/api/vsat/stage` refuses every payment field and validates the values it still accepts.

## Switching the flag (one command)

```sql
update public.app_flags set value = 'paid', updated_at = now(), updated_by = '<your name>'
where key = 'peerpath_eligibility';
-- back: value = 'registered'   ·   emergency stop: value = 'off'
```

Staging first. Production only with explicit approval. On a database where 0031 runs for the first time (production) the flag starts at `off`; staging was set to `registered` by hand for testing.

## Consequences

- Applicants must log in to book; the booking page shows their details read-only.
- Popup links (`Complete payment`, `Register now`) go to `/apply` with `?next=<booking page>`; `/apply` sends the user back there after registering (or shows a "Continue where you left off" button). December: change `PEERPATH_LINKS.completePayment` in `src/lib/peerpath/constants.ts` (one line).
- `EMAIL_NOT_VERIFIED` has no link: the popup verifies the login email in place (email OTP, `updateUser` + `verifyOtp('email_change')`), because no existing page does it reliably (existing applicants are redirected away from the old application form before its email step; the profile popup trusts the editable `email_verified` flag).
- A paid user without an `application_manager` row is treated as not registered (strict definition).
- Users whose login has no OTP-verified email (e.g. phone-only logins) get `EMAIL_NOT_VERIFIED` and verify it in the popup. A missing phone never blocks a booking; the admin list shows "—".
- `application_stage_*` and the slot field are still user-writable through `/api/vsat/stage` (left as-is by decision; does not affect PeerPath, which only trusts `vsat_payments`).

## Alternatives considered

- **Keep email + phone proof:** rejected — anyone who knows a student's email and phone could act as them.
- **Columns on `application_manager` for "paid":** rejected — that table is upserted by several routes; a separate write-once table has exactly one writer.
- **Service-role `pp_book(uid, …)`:** rejected — the owner required `auth.uid()` as the only identity.
- **Reuse the shared `rate_limit_hit`:** rejected — anyone can call it with any key and fill up another user's limit.
