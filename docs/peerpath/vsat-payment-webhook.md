# VSAT payment webhook — contract (for December, not built yet)

This is the agreement the future VSAT payment webhook must follow. It is the **only** thing allowed to write `public.vsat_payments`. Nothing here is implemented yet.

## Endpoint

`POST /api/payments/vsat-webhook` (Next.js route, Node runtime, `dynamic = "force-dynamic"`).

Reuse the existing Cashfree helpers in `src/lib/payments/cashfree.ts` (`verifyWebhookSignature`), the same way `/api/payments/cashfree-webhook` does for events.

## Rules

1. **Verify the signature on the raw body** (`x-webhook-signature` + `x-webhook-timestamp`) before parsing anything. Bad or missing signature → `401`, no DB access. Reject timestamps older than 5 minutes.
2. **Never trust the payload's status or amount.** Re-fetch the order from Cashfree with the server key and act only if it is `PAID`.
3. **Know whose payment it is from our own order, not from the payload.** The order must have been created by our server for a logged-in user (an order ledger like `event_payments`: `cf_order_id`, `user_id` = auth id, `amount` from the DB). Unknown order → log and `200`.
4. **Amount must equal the VSAT fee stored in the DB** for that order. Mismatch → log, alert, do not write.
5. **Idempotent by event id and order id.** Write:
   ```sql
   insert into public.vsat_payments (lead_id, paid_at, payment_ref, provider, provider_event_id, amount, currency)
   values ($user_id, $paid_at, $cf_order_id, 'cashfree', $event_id, $amount, 'INR')
   on conflict do nothing;
   ```
   `lead_id` (primary key), `payment_ref` and `provider_event_id` are unique, so a retried webhook or a second event for the same order does nothing.
6. **Write only `vsat_payments`.** The table is write-once (no update/delete). The fee is non-refundable: there is no refund or reversal logic. (Optional, separate decision: also set `application_manager.payment_stage_1 = 'payment_approved'` for the CRM display — that field is display-only and is never used to decide access.)
7. **Always answer `200` except for a bad signature (`401`)**, so Cashfree does not hammer retries; errors are logged, never returned.
8. **Service role key on the server only.** Never in the browser bundle, never logged.

## Backfill plan — users who already paid elsewhere

`application_manager.payment_stage_*` must **not** be used as the source: until H-01 was fixed, applicants could set it themselves.

1. **Source of truth:** the Cashfree payments report for VSAT orders (or the finance team's payment export), filtered to successful VSAT-fee payments.
2. **Match each payment to an account** by the order's customer id (auth user id) or, for older payments, by the verified email/phone on the payment → `auth.users` / `application_manager.lead_id`. Anything that does not match exactly goes to a manual list.
3. **Dry run:** produce a CSV `lead_id, email, order_id, amount, paid_at, match_method` — no writes.
4. **Manager review** of the CSV (sign-off).
5. **Insert** with the service role in one transaction, `provider = 'backfill'`, `payment_ref = <order id>`, `on conflict do nothing`. Re-running is safe.
6. **Check:** count of `vsat_payments` rows with `provider = 'backfill'` equals the approved CSV rows; spot-check 10 accounts in the booking flow with the flag on `paid` (staging first).
