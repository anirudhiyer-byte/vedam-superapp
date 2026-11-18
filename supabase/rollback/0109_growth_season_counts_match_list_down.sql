-- Rollback 0109 · puts back the 0108 body of growth__season_ids (paid counts every payment lead_id again).
-- Nothing else was changed by 0109.

create or replace function public.growth__season_ids(p_kind text, p_from date, p_to date, p_exam date)
returns setof uuid language plpgsql stable security definer set search_path to '' as $fn$
begin
  if p_kind = 'leads' then
    return query select lm.lead_id from public.lead_manager lm
      where (lm.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to;
  elsif p_kind = 'paid' then
    return query select vp.lead_id
      from (select x.lead_id, (min(x.paid_at) at time zone 'Asia/Kolkata')::date d from public.vsat_payments x group by x.lead_id) vp
      where case when p_exam is null then vp.d between p_from and p_to
                 else exists (select 1 from public.application_manager am join public.vsat_exam_dates ed on ed.id = am.exam_date_id
                               where am.lead_id = vp.lead_id and ed.exam_date = p_exam) end;
  elsif p_kind = 'enrolled' then
    return query select e.lead_id
      from (select am.lead_id,
                   (min(coalesce(am.enrollment_paid_at, am.last_updated_date)) at time zone 'Asia/Kolkata')::date d,
                   coalesce(bool_or(ed.exam_date = p_exam), false) on_exam
              from public.application_manager am left join public.vsat_exam_dates ed on ed.id = am.exam_date_id
             where am.enrollment_stage = 'approved' and am.lead_id is not null
             group by am.lead_id) e
      where case when p_exam is null then e.d between p_from and p_to else e.on_exam end;
  end if;
end $fn$;

-- same grants as 0108 (create or replace keeps them; repeated so this file stands on its own)
revoke all on function public.growth__season_ids(text, date, date, date) from public, anon, authenticated;
