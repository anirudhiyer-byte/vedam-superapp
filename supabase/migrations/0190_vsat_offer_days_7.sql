-- 0190 · VSAT offer: default validity = 7 days on both campuses (sir's 24 Nov review) — staging first.
--
-- Sir said the offer is valid for 7 days. The campus default (vsat_campus_settings.offer_days) was still the older
-- value: 0079 seeded 5 / 5, and staging had Pune at 2. This sets Pune and Gurugram to 7.
-- The release can still set other days per student ("Days to pay", 0180), and an admin can still change the default
-- on Scholarship & Scoring (0098). Offers already released keep their last date.
--
-- Data only. The values before this file are kept in the column comment, so the rollback puts back exactly what each
-- database had. No settings-audit row: that log needs a signed-in admin (user_id not null); this file is the record.
--
-- Rollback: supabase/rollback/0190_vsat_offer_days_7_down.sql
-- Tests:    supabase/tests/vsat_offer_days_7.test.sql

do $m$
declare v_prev jsonb;
begin
  select jsonb_object_agg(s.campus, s.offer_days) into v_prev from public.vsat_campus_settings s;
  execute format('comment on column public.vsat_campus_settings.offer_days is %L',
    'Default days to pay after the offer is released. 0190 set 7 (sir, 24 Nov 2026). Before 0190: ' || coalesce(v_prev, '{}'::jsonb)::text);
  update public.vsat_campus_settings s
     set offer_days = 7, updated_at = now()
   where s.campus in ('pune', 'gurugram') and s.offer_days <> 7;
end $m$;
