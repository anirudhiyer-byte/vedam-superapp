# Calling CRM · TeleCMI telephony (migration 0147)

Click-to-call, call recordings and call-event ingest for the Calling CRM. **Off by
default** — nothing calls TeleCMI until the env vars are set and the flag is flipped.

## What it does

- A caller taps **Call** on a lead in the Console (`/caller`). The route
  `POST /api/calling/call` asks `calling_telecmi_prepare` (checks the caller role, that
  the lead is assigned to them, the flag, and their TeleCMI mapping), then POSTs TeleCMI
  `click2call` with the **app secret from env**. The caller's own phone (**mobile**
  follow-me) or **browser softphone** rings first, then the lead.
- When the call ends TeleCMI POSTs a CDR to `/api/telecmi/webhook/<secret>`, which the
  service role hands to `calling_telecmi_ingest`. It matches the call to a lead by phone
  (last 10 digits) and to the caller by TeleCMI agent id, and stores status / duration /
  recording on a `calling_call_events` row. Unmatched calls are still stored.
- Recordings stream through `/api/calling/recording/<file>` (auth + ownership checked),
  only once the recording endpoint is configured.

Per-caller **call mode** is chosen by the admin: `mobile` or `softphone`.

## Going live (staging first, then prod)

1. **TeleCMI dashboard** (doc.telecmi.com): note the **app secret** (business number →
   DEVELOPER → APP SECRET) and each caller's **user id** (e.g. `208_1111112`). Register the
   webhook: Settings → Webhooks → Add → CDR (and Live Events), method POST, URL
   `https://<host>/api/telecmi/webhook/<TELECMI_WEBHOOK_SECRET>`.
2. **Env vars** (Vercel → the right environment; **staging values on staging first**):
   - `TELECMI_SECRET` — the TeleCMI app secret (used by click2call).
   - `TELECMI_WEBHOOK_SECRET` — a random string; must equal the `<secret>` path segment
     in the webhook URL you registered.
   - `TELECMI_CALLERID` — *(optional)* default caller-id DID shown to leads, digits only.
   - `TELECMI_RECORDING_URL` — *(optional)* recording fetch URL template containing
     `{file}` (e.g. `https://…/recording?file={file}&…secret…`). Until set, recording
     links return `NOT_CONFIGURED` — nothing else breaks.
3. **Map the callers**: Admin → Growth → Calling → **Callers** → *Telephony*. Set each
   caller's TeleCMI user id + mode (+ optional caller id), Active on.
4. **Flip the flag** (staging first; prod only with the owner's OK):
   ```sql
   update public.app_flags set value = 'on', updated_at = now(), updated_by = '<name>'
    where key = 'telecmi_enabled';
   ```

To turn it off again, set the flag back to `off` — the Call button disappears and the
routes refuse calls; existing call history stays.

## Security

- RLS on, no policies, all grants revoked on both new tables — browsers have zero table
  access; everything goes through the admin/caller-checked RPCs.
- `calling_telecmi_ingest` is revoked from **every** client role (service key only), so a
  browser can never fabricate a call record. The webhook is guarded by the secret path
  segment (constant-time compare), like `wheebox-callback`.
- The app secret and webhook secret live only in env — never in the DB, never committed.
- `/api/calling/call` checks Origin (CSRF) on cookie requests and applies a per-IP limit.

Tests: `supabase/tests/calling_telecmi.test.sql` (staging only). Rollback:
`supabase/rollback/0147_calling_telecmi_down.sql`.
