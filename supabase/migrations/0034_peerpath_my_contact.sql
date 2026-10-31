-- 0034 · PeerPath: pp_my_contact() — the read-only details shown on the booking page
--
-- Returns the logged-in user's name / email / phone exactly as pp_book will store
-- them (same order: application_manager → profiles → auth account; same format
-- checks). Read-only, own data only (auth.uid()), logged-in users only.
-- The lookup order MUST stay the same as in pp_book_core (0033); the DB test
-- "C contact shown = contact stored" checks that they agree.
--
-- Rollback: supabase/rollback/0034_peerpath_my_contact_down.sql

create or replace function public.pp_my_contact()
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
declare
  c_email constant text := '^[^\s@]+@[^\s@]+\.[^\s@]+$';
  c_phone constant text := '^\+?[0-9]{10,15}$';
  v_uid uuid := auth.uid();
  am_name text; am_email text; am_phone text;
  pr_name text; pr_email text; pr_phone text;
  au_email text; au_phone text;
  v_name text; v_email text; v_phone text;
begin
  if v_uid is null then return null; end if;
  select am.registered_name, am.registered_email, am.registered_mobile
    into am_name, am_email, am_phone
    from public.application_manager am where am.lead_id = v_uid
    order by am.created_at desc nulls last limit 1;
  select pr.full_name, pr.email, pr.phone into pr_name, pr_email, pr_phone
    from public.profiles pr where pr.id = v_uid;
  select u.email, u.phone into au_email, au_phone from auth.users u where u.id = v_uid;

  v_email := case
    when lower(btrim(am_email)) ~* c_email then lower(btrim(am_email))
    when lower(btrim(pr_email)) ~* c_email then lower(btrim(pr_email))
    when lower(btrim(au_email)) ~* c_email then lower(btrim(au_email)) end;
  v_phone := case
    when regexp_replace(coalesce(am_phone, ''), '[\s-]', '', 'g') ~ c_phone then regexp_replace(am_phone, '[\s-]', '', 'g')
    when regexp_replace(coalesce(pr_phone, ''), '[\s-]', '', 'g') ~ c_phone then regexp_replace(pr_phone, '[\s-]', '', 'g')
    when regexp_replace(coalesce(au_phone, ''), '[\s-]', '', 'g') ~ c_phone then regexp_replace(au_phone, '[\s-]', '', 'g') end;
  v_name := left(coalesce(nullif(btrim(am_name), ''), nullif(btrim(pr_name), ''), 'Applicant'), 80);
  if char_length(v_name) < 2 then v_name := 'Applicant'; end if;

  return jsonb_build_object('name', v_name, 'email', v_email, 'phone', v_phone,
                            'complete', v_email is not null and v_phone is not null);
end $fn$;

revoke all on function public.pp_my_contact() from public, anon;
grant execute on function public.pp_my_contact() to authenticated;
