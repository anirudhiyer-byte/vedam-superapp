-- 0067 · Communication Manager, Slice 8 — Manage Automation, READ-ONLY.
--
-- What this adds: ONE new function, public.comm_automation_list(). Nothing existing is changed:
--   no table, column, index, policy, trigger, grant or existing function is touched.
--   The two engines (cron routes /api/cron/whatsapp-automations and /api/cron/comms-journeys) are not
--   called or changed; this function never writes.
--
-- Tables read (never written), columns as they exist on staging (information_schema):
--   whatsapp_automations     id, name, enabled, trigger_type, channel, created_at, last_run_at
--   whatsapp_automation_runs automation_id, sent, failed, fired_at
--   comms_journeys           id, name, enabled, channel, product, created_at, last_run_at
--   comms_journey_runs       journey_id (count only)
-- Never read or returned: template_id, message_type, variable_mapping, conditions, branches, event_id,
--   offset_minutes, scheduled_at, created_by, run_key, user_id (templates, message content, audience
--   filters and people stay out of the answer).
-- Neither table has a start or an end date, so none is returned.
--
-- Security:
--   * SECURITY DEFINER, STABLE, set search_path to '' (all names schema-qualified)
--   * first statement: admin check via public.comm__guard (public.is_admin()) -> SQLSTATE 42501 for anyone else
--   * output is a fixed whitelist; text is cut (name 200) or mapped to fixed words (channel, trigger,
--     product, last_status); counts are integers
--   * at most 500 rows per engine (newest first); "truncated" says when there were more
--   * revoke execute from public, anon; grant execute to authenticated only
--
-- Rollback: supabase/rollback/0067_comm_slice8_automation_read_down.sql (drops exactly this function).
-- Tests:    supabase/tests/comm_slice8_automation.test.sql (staging only, rolls itself back).

create or replace function public.comm_automation_list()
returns jsonb
language plpgsql stable security definer
set search_path to ''
as $$
declare
  v_cap constant int := 500;
  v_wa jsonb; v_j jsonb; v_wa_more boolean; v_j_more boolean;
begin
  perform public.comm__guard(null, null, null, null);

  with a as (
    select w.id, w.name, w.enabled, w.trigger_type, w.channel, w.created_at, w.last_run_at
      from public.whatsapp_automations w
     order by w.created_at desc, w.id
     limit v_cap + 1
  ), shown as (
    select a.*, row_number() over (order by a.created_at desc, a.id) as ord from a
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'engine', 'whatsapp',
           'id', s.id,
           'name', left(s.name, 200),
           'enabled', s.enabled,
           'channel', case when s.channel in ('whatsapp', 'email') then s.channel else 'other' end,
           'trigger', case when s.trigger_type in ('event_before', 'event_after', 'scheduled') then s.trigger_type else 'other' end,
           'product', null,
           'created_at', s.created_at,
           'last_run_at', s.last_run_at,
           'runs', coalesce(rc.n, 0),
           'last_sent', lr.sent,
           'last_failed', lr.failed,
           'last_status', case
              when lr.sent is null then 'never'
              when lr.sent > 0 and lr.failed > 0 then 'partial'
              when lr.failed > 0 then 'failed'
              when lr.sent > 0 then 'sent'
              else 'none' end
         ) order by s.ord) filter (where s.ord <= v_cap), '[]'::jsonb),
         coalesce(bool_or(s.ord > v_cap), false)
    into v_wa, v_wa_more
    from shown s
    left join lateral (select count(*)::int as n from public.whatsapp_automation_runs r where r.automation_id = s.id) rc on true
    left join lateral (select r.sent, r.failed from public.whatsapp_automation_runs r
                        where r.automation_id = s.id order by r.fired_at desc, r.id desc limit 1) lr on true;

  with a as (
    select j.id, j.name, j.enabled, j.channel, j.product, j.created_at, j.last_run_at
      from public.comms_journeys j
     order by j.created_at desc, j.id
     limit v_cap + 1
  ), shown as (
    select a.*, row_number() over (order by a.created_at desc, a.id) as ord from a
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'engine', 'journey',
           'id', s.id,
           'name', left(s.name, 200),
           'enabled', s.enabled,
           'channel', case when s.channel in ('whatsapp', 'email') then s.channel else 'other' end,
           'trigger', 'conditions',
           'product', case when s.product ~ '^[a-z0-9_-]{1,40}$' then s.product else 'other' end,
           'created_at', s.created_at,
           'last_run_at', s.last_run_at,
           'runs', coalesce(rc.n, 0),
           'last_sent', null,
           'last_failed', null,
           'last_status', case when coalesce(rc.n, 0) > 0 then 'fired' else 'never' end
         ) order by s.ord) filter (where s.ord <= v_cap), '[]'::jsonb),
         coalesce(bool_or(s.ord > v_cap), false)
    into v_j, v_j_more
    from shown s
    left join lateral (select count(*)::int as n from public.comms_journey_runs r where r.journey_id = s.id) rc on true;

  -- both lists newest first, merged
  return jsonb_build_object(
    'total', jsonb_array_length(v_wa) + jsonb_array_length(v_j),
    'truncated', v_wa_more or v_j_more,
    'rows', coalesce((select jsonb_agg(e order by (e->>'created_at')::timestamptz desc, e->>'id')
                        from jsonb_array_elements(v_wa || v_j) e), '[]'::jsonb));
end $$;

revoke all on function public.comm_automation_list() from public, anon;
grant execute on function public.comm_automation_list() to authenticated;
