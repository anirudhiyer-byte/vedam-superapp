-- Rollback of 0133_growth_telegram_speed.sql — puts the four functions back exactly as 0132 defined them (copied from
-- 0132), then removes the stored UTM key (trigger, trigger function, index, column). No rows are lost.

create or replace function public.growth__tg_utm_owner(p_link text, p_campaign uuid, p_id uuid)
returns text language sql stable security definer set search_path to '' as $fn$
  select r.influencer_name from public.growth_tg_rows r
   where r.deleted_at is null and r.id is distinct from p_id and r.campaign_id = p_campaign
     and (lower(btrim(r.utm_link)) = lower(btrim(p_link))
          or (public.growth__utm_key(p_link) is not null and public.growth__utm_key(r.utm_link) = public.growth__utm_key(p_link)))
   order by r.created_at, r.id limit 1;
$fn$;

create or replace function public.growth__tg_attr(p_trash boolean)
returns table (id uuid, utm_key text, leads int, payments int, enrollments int, leads_all int, payments_all int, enrollments_all int)
language sql stable security definer set search_path to '' as $fn$
  with r as materialized (
    select a.id, public.growth__utm_key(a.utm_link) k, c.campaign_start s, c.campaign_end e
      from public.growth_tg_rows a left join public.vsat_campaigns c on c.id = a.campaign_id
     where (a.deleted_at is not null) = p_trash
  ), l as materialized (
    select * from public.growth__leads(array(select distinct r.k from r where r.k is not null))
  ), allt as (
    select l.k, count(*)::int n, count(l.paid_d)::int p, count(l.enrolled_d)::int en from l group by l.k
  ), win as (
    select r.id, count(l.lead_id)::int n, count(l.paid_d)::int p, count(l.enrolled_d)::int en
      from r join l on l.k = r.k and r.s is not null and r.e is not null and l.created_d between r.s and r.e
     group by r.id
  )
  select r.id, r.k, coalesce(win.n, 0), coalesce(win.p, 0), coalesce(win.en, 0),
         coalesce(allt.n, 0), coalesce(allt.p, 0), coalesce(allt.en, 0)
    from r left join allt on allt.k = r.k left join win on win.id = r.id;
$fn$;

create or replace function public.growth_tg_trash(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_ids uuid[]; n int; v_dup text;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['ids', 'trash']);
  v_ids := public.growth__tg_ids(p);
  if jsonb_typeof(p->'trash') is distinct from 'boolean' then raise exception 'BAD_VALUE: trash' using errcode = '22023'; end if;
  if (p->>'trash')::boolean then
    update public.growth_tg_rows set deleted_at = now(), updated_at = now() where id = any (v_ids) and deleted_at is null;
    get diagnostics n = row_count;
  else
    begin
      update public.growth_tg_rows set deleted_at = null, updated_at = now() where id = any (v_ids) and deleted_at is not null;
      get diagnostics n = row_count;
    exception when unique_violation then
      raise exception 'DUPLICATE_UTM' using errcode = '22023';
    end;
    select a.influencer_name into v_dup
      from public.growth_tg_rows a join public.growth_tg_rows b on a.id < b.id and a.campaign_id = b.campaign_id
     where a.deleted_at is null and b.deleted_at is null and (a.id = any (v_ids) or b.id = any (v_ids))
       and public.growth__utm_key(a.utm_link) is not null and public.growth__utm_key(a.utm_link) = public.growth__utm_key(b.utm_link)
     limit 1;
    if v_dup is not null then raise exception 'DUPLICATE_UTM' using errcode = '22023', detail = v_dup; end if;
  end if;
  return jsonb_build_object('changed', n);
end $fn$;

create or replace function public.growth_tg_import(p jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare r jsonb; i int := 0; errs jsonb := '[]'::jsonb; v_mode text; v_id uuid; v_camp uuid; o jsonb; v_add int := 0; v_upd int := 0;
begin
  perform public.growth__admin();
  perform public.growth__keys(p, array['rows', 'mode']);
  v_mode := coalesce(p->>'mode', 'upsert');
  if v_mode not in ('add', 'upsert') then raise exception 'BAD_VALUE: mode' using errcode = '22023'; end if;
  if jsonb_typeof(p->'rows') is distinct from 'array' or jsonb_array_length(p->'rows') = 0 then raise exception 'BAD_VALUE: rows' using errcode = '22023'; end if;
  if jsonb_array_length(p->'rows') > 2000 then raise exception 'TOO_MANY_ROWS' using errcode = '22023'; end if;
  for r in select x from jsonb_array_elements(p->'rows') x loop
    i := i + 1;
    begin
      if jsonb_typeof(r) <> 'object' or r ? 'id' then raise exception 'BAD_REQUEST' using errcode = '22023'; end if;
      v_id := null;
      if v_mode = 'upsert' and jsonb_typeof(r->'utm_link') = 'string' and jsonb_typeof(r->'used_in') = 'string' then
        v_camp := public.growth__campaign_id(r, 'used_in');
        select x.id into v_id from public.growth_tg_rows x
         where x.deleted_at is null and x.campaign_id = v_camp
           and (lower(btrim(x.utm_link)) = lower(btrim(r->>'utm_link'))
                or (public.growth__utm_key(r->>'utm_link') is not null and public.growth__utm_key(x.utm_link) = public.growth__utm_key(r->>'utm_link')))
         order by x.created_at, x.id limit 1;
      end if;
      if v_id is null then
        perform public.growth__tg_save(r); v_add := v_add + 1;
      else
        o := public.growth__tg_obj(v_id) || (r - 'utm_link' - 'used_in');
        perform public.growth__tg_save(o); v_upd := v_upd + 1;
      end if;
    exception when sqlstate '22023' then
      if jsonb_array_length(errs) < 50 then errs := errs || jsonb_build_object('row', i, 'error', sqlerrm); end if;
    end;
  end loop;
  if jsonb_array_length(errs) > 0 then raise exception 'IMPORT_FAILED' using errcode = 'P0001', detail = errs::text; end if;
  return jsonb_build_object('added', v_add, 'updated', v_upd);
end $fn$;

create or replace function public.growth__leads(p_keys text[])
returns table (lead_id uuid, k text, created_d date, paid_d date, enrolled_d date)
language sql stable security definer set search_path to '' as $fn$
  select lm.lead_id,
         public.vsat__norm_utm(lm.primary_utm),
         (coalesce(lm.user_registration_date, lm.created_at) at time zone 'Asia/Kolkata')::date,   -- 0122: registration day (creation day when empty)
         (select (min(vp.paid_at) at time zone 'Asia/Kolkata')::date from public.vsat_payments vp where vp.lead_id = lm.lead_id),
         (select (min(coalesce(am.enrollment_paid_at, am.last_updated_date)) at time zone 'Asia/Kolkata')::date
            from public.application_manager am where am.lead_id = lm.lead_id and am.enrollment_stage = 'approved')
    from public.lead_manager lm
   where public.vsat__norm_utm(lm.primary_utm) = any (p_keys)
     and (lm.registered_email is null or lm.registered_email not ilike '%@vedam.org');   -- 0122: staff are not leads
$fn$;

drop trigger if exists trg_growth_tg_rows_key on public.growth_tg_rows;
drop function if exists public.growth__tg_key_trg();
drop index if exists public.growth_tg_rows_key;
alter table public.growth_tg_rows drop column if exists utm_key;
