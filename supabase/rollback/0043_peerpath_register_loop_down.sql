-- Rollback of 0043 · exact restore of pp_vsat_eligible (0033) and pp_contact_for (0036).
-- Effect: users registered only through /apply get NOT_REGISTERED again (the loop returns).

create or replace function public.pp_vsat_eligible(p_uid uuid)
returns text language plpgsql stable security definer set search_path to '' as $fn$
declare v_mode text;
begin
  if p_uid is null then return 'NOT_LOGGED_IN'; end if;

  select f.value into v_mode from public.app_flags f where f.key = 'peerpath_eligibility';
  if v_mode is null or v_mode not in ('registered', 'paid') then
    return 'BOOKING_CLOSED';                         -- off, missing or unknown → closed (fail safe)
  end if;

  -- admins skip the VSAT check (same rule as pp_is_admin, evaluated for p_uid)
  if public.has_role(p_uid, 'admin'::public.app_role)
     or exists (select 1 from auth.users u
                where u.id = p_uid and lower(u.email) like '%@vedam.org' and u.email_confirmed_at is not null) then
    return 'OK';
  end if;

  if not exists (select 1 from public.application_manager am where am.lead_id = p_uid) then
    return 'NOT_REGISTERED';
  end if;
  if v_mode = 'paid' and not exists (select 1 from public.vsat_payments vp where vp.lead_id = p_uid) then
    return 'PAYMENT_PENDING';
  end if;
  return 'OK';
end $fn$;

create or replace function public.pp_contact_for(p_uid uuid)
returns jsonb language plpgsql stable set search_path to '' as $fn$
declare
  c_email constant text := '^[^\s@]+@[^\s@]+\.[^\s@]+$';
  c_phone constant text := '^\+?[0-9]{10,15}$';
  am_name text; am_email text; pr_name text; au_name text;
  au_email text; au_phone text; au_email_at timestamptz; au_phone_at timestamptz;
  v_name text; v_email text; v_phone text;
begin
  if p_uid is null then return null; end if;
  select am.registered_name into am_name
    from public.application_manager am where am.lead_id = p_uid
    order by am.created_at desc nulls last limit 1;
  -- email: the newest valid email on the user's OWN application (lead_id = this login)
  select lower(btrim(am.registered_email)) into am_email
    from public.application_manager am
   where am.lead_id = p_uid
     and lower(btrim(am.registered_email)) ~* c_email
     and char_length(btrim(am.registered_email)) <= 254
   order by am.created_at desc nulls last limit 1;
  select pr.full_name into pr_name from public.profiles pr where pr.id = p_uid;
  select u.email, u.email_confirmed_at, u.phone, u.phone_confirmed_at, u.raw_user_meta_data ->> 'full_name'
    into au_email, au_email_at, au_phone, au_phone_at, au_name
    from auth.users u where u.id = p_uid;

  -- email: own application first; else the login email only if Supabase Auth verified it by OTP
  v_email := coalesce(am_email,
               case when au_email_at is not null and lower(btrim(au_email)) ~* c_email then lower(btrim(au_email)) end);
  -- phone: only the login phone, and only once Supabase Auth verified it by OTP (optional)
  v_phone := regexp_replace(coalesce(au_phone, ''), '[\s-]', '', 'g');
  v_phone := case when au_phone_at is not null and v_phone ~ c_phone
                  then case when left(v_phone, 1) = '+' then v_phone else '+' || v_phone end end;
  v_name := left(coalesce(nullif(btrim(am_name), ''), nullif(btrim(pr_name), ''), nullif(btrim(au_name), ''), 'Applicant'), 80);
  if char_length(v_name) < 2 then v_name := 'Applicant'; end if;
  return jsonb_build_object('name', v_name, 'email', v_email, 'phone', v_phone);
end $fn$;

revoke all on function public.pp_vsat_eligible(uuid) from public, anon, authenticated, service_role;
revoke all on function public.pp_contact_for(uuid) from public, anon, authenticated, service_role;
