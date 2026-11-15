-- Rollback for 0084_vsat_jee_floor_on.sql — JEE floor back off on both campuses (the 0079 default).

update public.vsat_campus_settings
   set jee_floor_enabled = false, updated_at = now()
 where campus in ('pune', 'gurugram');
