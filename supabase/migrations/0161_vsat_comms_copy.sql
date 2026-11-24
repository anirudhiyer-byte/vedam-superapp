-- 0161 · VSAT stage comms — updated email copy (first_half, application_started,
--        payment_reminder_24h, payment_confirmed).
--
-- Marketing-approved copy refresh before these steps are re-enabled. Text only: this changes the
-- email subject/body stored in vsat_comm_steps; it does NOT enable any step or change test_mode
-- (all four stay as configured). Placeholders are {{name}}, {{amount}}, {{apply_link}},
-- {{dashboard_link}}, {{receipt_link}} (filled by lib/vsat/comms.ts).
--
-- WhatsApp copy is NOT here: WhatsApp sends through a pre-approved TrustSignal template referenced
-- by wa_template_id; its wording lives in TrustSignal, not in this table. Update the WhatsApp text
-- by approving a new template there and setting wa_template_id.
--
-- Idempotent (plain UPDATEs by step_key). Rollback: supabase/rollback/0161_vsat_comms_copy_down.sql

update public.vsat_comm_steps set
  email_subject = 'Your VSAT journey has begun 🎉',
  email_body = $html$<p>Hi {{name}},</p><p>Welcome to Vedam! Your Vedam One account is ready and your VSAT journey has begun. You're just one step away — complete your application and start preparing for VSAT using the prep kit and sample papers.</p><p><a href="{{apply_link}}">Continue your application →</a></p><p>Warmly,<br>Team Vedam</p>$html$
where step_key = 'first_half';

update public.vsat_comm_steps set
  email_subject = 'Pay your VSAT fee to unlock the exam',
  email_body = $html$<p>Hi {{name}},</p><p>Your VSAT application has started! You are one step away from VSAT — complete your exam fee payment and select your test slot to appear for VSAT.</p><p><a href="{{dashboard_link}}">Continue application →</a></p><p>Also get a concession of ₹200 on VSAT, valid only for the first 24 hours.</p><p>Cheering you on,<br>Team Vedam</p>$html$
where step_key = 'application_started';

update public.vsat_comm_steps set
  email_subject = 'Your VSAT fee is pending — early-bird closing soon',
  email_body = $html$<p>Hi {{name}},</p><p>Just a few hours left before the VSAT scholarship ends — and we'd hate for you to miss out! Your VSAT registration is 99% complete; all that's left is the final step. Complete it now to avail up to 20% scholarship on your VSAT registration fee.</p><p><a href="{{dashboard_link}}">Complete application →</a></p><p>Warm wishes,<br>Team Vedam</p>$html$
where step_key = 'payment_reminder_24h';

update public.vsat_comm_steps set
  email_subject = 'Payment received for your VSAT application',
  email_body = $html$<p>Hi {{name}},</p><p>You have successfully registered for VSAT! We've received your VSAT fee of ₹{{amount}}. Your receipt is attached, and you can also view it <a href="{{receipt_link}}">here</a>.</p><p><b>Next steps:</b></p><ul><li>Pick your exam date</li><li>Fill your application form</li><li>Take the mock test</li></ul><p>All the best,<br>Team Vedam</p>$html$
where step_key = 'payment_confirmed';
