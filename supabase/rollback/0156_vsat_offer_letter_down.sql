-- Rollback of 0156 · VSAT offer (Acceptance) letter
-- Drops vsat_offer_letter and puts the 0144 offer email text back (only if the step still has the 0156 text).

drop function if exists public.vsat_offer_letter(jsonb);

update public.vsat_comm_steps
   set email_body = '<p>Hi {{name}},</p><p>Congratulations! You have been offered admission to Vedam School of Technology, {{campus}} campus, with a <b>{{scholarship}}% scholarship</b>.</p><p>To accept the offer, block your seat by paying the enrollment fee of <b>₹{{amount}}</b> from your dashboard.</p><p><b>Pay by:</b> {{deadline_date}}, {{deadline_time}} IST. After this, the offer expires.</p><p><a href="{{dashboard_link}}">Accept and pay →</a></p><p>If you have any questions, reply to this email and the admissions team will help you.</p><p>Warm regards,<br>Team Vedam</p>',
       updated_at = now()
 where step_key = 'offer_released'
   and md5(email_body) = '415665ecd8fb7c048627c5e66a28e5e4';
