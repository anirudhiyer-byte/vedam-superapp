-- Migration 0003 — Null-guard vedam_one_refresh_profile
--
-- Bug: deleting an auth user sets certificates.user_id = NULL (ON DELETE SET
-- NULL, by design to keep cert history). That UPDATE fires trg_vo_cert, which
-- calls vedam_one_refresh_profile(NEW.user_id) = NULL, which tried to insert
-- NULL into vedam_one_refresh_queue.user_id (NOT NULL) and aborted the whole
-- delete. So ANY admin deleting ANY user who has a certificate was blocked.
--
-- Fix: the refresh is meaningless for a NULL user — ignore it.

create or replace function public.vedam_one_refresh_profile(p_user uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if p_user is null then return; end if;   -- ignore null (certificates.user_id set null on user delete)
  insert into public.vedam_one_profiles(user_id, public_id, full_name, email, phone, state, city, signup_at)
  select id, public_id, full_name, email, phone, state, city, created_at from public.profiles where id=p_user
  on conflict (user_id) do nothing;
  insert into public.vedam_one_refresh_queue(user_id) values (p_user) on conflict (user_id) do nothing;
end $function$;
