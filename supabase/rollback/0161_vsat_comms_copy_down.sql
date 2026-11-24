-- Rollback for 0161_vsat_comms_copy.sql — restores the previous email copy for the four steps.

update public.vsat_comm_steps set
  email_subject = 'Your VSAT journey has begun 🎉',
  email_body = $html$<p>Hi {{name}},</p><p>Welcome to Vedam! Your Vedam One account is ready and your VSAT journey has begun. You're just one step away — complete the second half of your form to continue your application.</p><p><a href="{{apply_link}}">Continue your application →</a></p><p>Warmly,<br>Team Vedam</p>$html$
where step_key = 'first_half';

update public.vsat_comm_steps set
  email_subject = 'Pay your VSAT fee to unlock the exam',
  email_body = $html$<p>Hi {{name}},</p><p>Wonderful news — your VSAT application has started! To unlock your exam, a fee of ₹{{amount}} is needed, and your early-bird price stays open for the next 24 hours.</p><p><a href="{{dashboard_link}}">Complete your payment →</a></p><p>Cheering you on,<br>Team Vedam</p>$html$
where step_key = 'application_started';

update public.vsat_comm_steps set
  email_subject = 'Your VSAT fee is pending — early-bird closing soon',
  email_body = $html$<p>Hi {{name}},</p><p>A gentle reminder — your VSAT fee of ₹{{amount}} is still pending and your early-bird window is closing soon. Secure your seat whenever you're ready.</p><p><a href="{{dashboard_link}}">Complete your payment →</a></p><p>Warm wishes,<br>Team Vedam</p>$html$
where step_key = 'payment_reminder_24h';

update public.vsat_comm_steps set
  email_subject = 'Payment received — your VSAT receipt',
  email_body = $html$<p>Hi {{name}},</p><p>Thank you so much! We've received your VSAT fee of ₹{{amount}}. Your receipt is attached, and you can also view it <a href="{{receipt_link}}">here</a>.</p><p>You're all set — next, fill your application form, take your mock test, and pick your exam date on your dashboard.</p><p><a href="{{dashboard_link}}">Go to your dashboard →</a></p><p>Warmly,<br>Team Vedam</p>$html$
where step_key = 'payment_confirmed';
