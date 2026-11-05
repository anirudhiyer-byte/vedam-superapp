-- 0060 · Communication Manager, Slice 1 — READ-ONLY data for three admin pages:
--        Communication Logs, Communication Performance, Suppressions.
--
-- What this adds: new comm_* functions only. Nothing existing is changed:
--   no table, column, index, policy, grant or existing function is touched.
--   campaign_summary / campaign_report_filtered / campaign_recipients are not called or altered.
--
-- Tables read (never written): comms_campaigns, whatsapp_sends, email_events, comms_optouts.
--
-- Security (every public comm_* function):
--   * SECURITY DEFINER, set search_path to '' (all names schema-qualified)
--   * first statement: admin check (public.is_admin()) -> SQLSTATE 42501 for anyone else
--   * bad input -> SQLSTATE 22023 with a short code in the message
--   * paged: page 1..10000, size 1..100; date range half-open [from, to), at most 90 days
--   * revoke execute from public, anon; grant execute to authenticated only
-- Helpers comm__* are private: execute revoked from public, anon and authenticated.
-- They are SECURITY INVOKER and only ever run inside the comm_* functions (as the owner).
--
-- Rollback: supabase/rollback/0060_comm_slice1_read_down.sql (drops exactly these functions).
-- Tests:    supabase/tests/comm_slice1_read.test.sql (staging only, rolls itself back).

-- ── private helpers ─────────────────────────────────────────────────────────────

-- admin + paging + date-range check, shared by every comm_* function
create or replace function public.comm__guard(p_from timestamptz, p_to timestamptz, p_page int, p_size int)
returns void
language plpgsql stable
set search_path to ''
as $$
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if (p_from is null) <> (p_to is null) then
    raise exception 'range_incomplete' using errcode = '22023';
  end if;
  if p_from is not null and p_to <= p_from then
    raise exception 'range_invalid' using errcode = '22023';
  end if;
  if p_from is not null and p_to > p_from + interval '90 days' then
    raise exception 'range_too_long' using errcode = '22023';
  end if;
  if p_page is not null and (p_page < 1 or p_page > 10000) then
    raise exception 'page_invalid' using errcode = '22023';
  end if;
  if p_size is not null and (p_size < 1 or p_size > 100) then
    raise exception 'size_invalid' using errcode = '22023';
  end if;
end $$;

-- search text -> safe ILIKE pattern ('%' and '_' typed by the admin match literally); null/blank -> null
create or replace function public.comm__like(p text)
returns text
language plpgsql immutable
set search_path to ''
as $$
begin
  if p is null or btrim(p) = '' then return null; end if;
  if length(p) > 100 then
    raise exception 'search_too_long' using errcode = '22023';
  end if;
  return '%' || replace(replace(replace(btrim(p), '\', '\\'), '%', '\%'), '_', '\_') || '%';
end $$;

-- every sent message (email + WhatsApp) of the given campaigns, with the same
-- delivered / read / failed rules the existing campaign_report view uses
create or replace function public.comm__messages(p_campaigns uuid[])
returns table (campaign_id uuid, channel text, rid uuid, contact text, sent_at timestamptz,
               is_delivered boolean, is_read boolean, is_clicked boolean, is_failed boolean, reason text)
language sql stable
set search_path to ''
as $$
  select e.campaign_id, 'email'::text, e.id, e.to_email, e.sent_at,
         (e.delivered_at is not null),
         (e.opened_at is not null),
         (e.clicked_at is not null),
         (e.status = 'failed' or e.bounced_at is not null),
         case when e.bounced_at is not null then 'Bounced' when e.status = 'failed' then 'Failed' end
    from public.email_events e
   where e.campaign_id = any (p_campaigns)
  union all
  select w.campaign_id, 'whatsapp'::text, w.id, w.to_number, w.created_at,
         (w.delivered_at is not null or w.status in ('delivered', 'read')),
         (w.read_at is not null or w.status = 'read'),
         false,
         (w.status in ('failed', 'undelivered')),
         case when w.status in ('failed', 'undelivered') then coalesce(nullif(btrim(w.failed_reason), ''), 'Failed') end
    from public.whatsapp_sends w
   where w.campaign_id = any (p_campaigns)
$$;

-- one row per campaign ("job") with its counts and a display status
create or replace function public.comm__jobs(p_from timestamptz, p_to timestamptz, p_ids uuid[])
returns table (id uuid, channel text, name text, kind text, template text, audience text, recipient_count int,
               created_at timestamptz, scheduled_at timestamptz, status text,
               sent bigint, delivered bigint, read bigint, clicked bigint, failed bigint)
language sql stable
set search_path to ''
as $$
  with c as (
    select c.*
      from public.comms_campaigns c
     where (p_ids is null or c.id = any (p_ids))
       and (p_from is null or c.created_at >= p_from)
       and (p_to is null or c.created_at < p_to)
  ), m as (
    select x.campaign_id,
           count(*) as sent,
           count(*) filter (where x.is_delivered) as delivered,
           count(*) filter (where x.is_read) as read,
           count(*) filter (where x.is_clicked) as clicked,
           count(*) filter (where x.is_failed) as failed
      from public.comm__messages(array(select c.id from c)) x
     group by x.campaign_id
  )
  select c.id, c.channel, c.name, c.kind, c.template_ref,
         coalesce(nullif(btrim(c.audience_desc), ''), c.audience_source),
         coalesce(c.recipient_count, 0), c.created_at, c.scheduled_at,
         case
           when c.status = 'scheduled' or (c.scheduled_at is not null and c.scheduled_at > now()) then 'Scheduled'
           when c.status in ('queued', 'sending', 'in_progress') then 'In Progress'
           when c.status = 'closed' then 'Closed'
           when c.status = 'failed' then 'Failed'
           when coalesce(m.sent, 0) > 0 and m.failed = m.sent then 'Undelivered'
           else 'Completed'
         end,
         coalesce(m.sent, 0), coalesce(m.delivered, 0), coalesce(m.read, 0), coalesce(m.clicked, 0), coalesce(m.failed, 0)
    from c
    left join m on m.campaign_id = c.id
$$;

-- opt-outs, normalised for the Suppressions page (channel 'all' shows in both tabs)
create or replace function public.comm__optouts(p_channel text)
returns table (id uuid, contact text, reason text, source text, at timestamptz)
language sql stable
set search_path to ''
as $$
  select o.id,
         case when p_channel = 'Email' then o.email else o.phone end,
         case
           when p_channel = 'WhatsApp' then 'Unsubscribe'   -- WhatsApp has one list: opt-outs
           when o.reason ~* 'bounce' then 'Bounce'
           when o.reason ~* 'spam|complain' then 'Spam'
           when o.reason ~* 'block|manual' then 'Block'
           when o.reason ~* 'invalid|syntax' then 'Invalid'
           else 'Unsubscribe'
         end,
         coalesce(nullif(btrim(o.reason), ''), '-'),
         o.opted_out_at
    from public.comms_optouts o
   where (p_channel = 'Email' and o.channel in ('email', 'all') and o.email is not null)
      or (p_channel = 'WhatsApp' and o.channel in ('whatsapp', 'all') and o.phone is not null)
$$;

-- ── Communication Logs ──────────────────────────────────────────────────────────

create or replace function public.comm_logs_list(
  p_from timestamptz, p_to timestamptz, p_channel text, p_status text, p_template text, p_nature text,
  p_campaign text, p_search text, p_sort text, p_dir text, p_page int, p_size int)
returns jsonb
language plpgsql stable security definer
set search_path to ''
as $$
declare
  v_like text; v_camp text; v_job text; v_sort text := coalesce(p_sort, 'startDate'); v_dir text := coalesce(p_dir, 'desc');
  v_page int := coalesce(p_page, 1); v_size int := coalesce(p_size, 10); v_total bigint; v_rows jsonb;
begin
  perform public.comm__guard(p_from, p_to, v_page, v_size);
  if p_from is null then raise exception 'range_required' using errcode = '22023'; end if;
  if p_channel is not null and p_channel not in ('email', 'whatsapp') then raise exception 'channel_invalid' using errcode = '22023'; end if;
  if p_status is not null and p_status not in ('Scheduled', 'In Progress', 'Completed', 'Closed', 'Undelivered', 'Failed') then
    raise exception 'status_invalid' using errcode = '22023'; end if;
  if p_nature is not null and p_nature not in ('Bulk', 'Single User') then raise exception 'nature_invalid' using errcode = '22023'; end if;
  if v_sort not in ('startDate', 'targeted', 'delivered', 'template', 'status', 'jobId', 'channel') then
    raise exception 'sort_invalid' using errcode = '22023'; end if;
  if v_dir not in ('asc', 'desc') then raise exception 'dir_invalid' using errcode = '22023'; end if;
  if length(p_template) > 200 then raise exception 'template_too_long' using errcode = '22023'; end if;
  v_like := public.comm__like(p_search);
  v_camp := public.comm__like(p_campaign);
  -- "Job#1A2B3C4D" or "1a2b" -> id prefix search
  v_job := case when p_search is null then null
                else replace(replace(lower(regexp_replace(btrim(p_search), '^job#', '', 'i')), '%', ''), '_', '') || '%' end;

  with j as (
    select * from public.comm__jobs(p_from, p_to, null) j
     where (p_channel is null or j.channel = p_channel)
       and (p_status is null or j.status = p_status)
       and (p_template is null or j.template = p_template)
       and (p_nature is null or (p_nature = 'Bulk') = (j.recipient_count > 1))
       and (v_camp is null or j.name ilike v_camp)
       and (v_like is null or j.name ilike v_like or j.template ilike v_like
            or (length(v_job) > 1 and j.id::text like v_job))
  ), ranked as (
    select j.*, row_number() over (order by
        case when v_dir = 'asc' then case v_sort when 'startDate' then extract(epoch from j.created_at)
                                                 when 'targeted' then j.recipient_count
                                                 when 'delivered' then j.delivered end end asc nulls last,
        case when v_dir = 'desc' then case v_sort when 'startDate' then extract(epoch from j.created_at)
                                                  when 'targeted' then j.recipient_count
                                                  when 'delivered' then j.delivered end end desc nulls last,
        case when v_dir = 'asc' then case v_sort when 'template' then j.template when 'status' then j.status
                                                 when 'jobId' then j.id::text when 'channel' then j.channel end end asc nulls last,
        case when v_dir = 'desc' then case v_sort when 'template' then j.template when 'status' then j.status
                                                  when 'jobId' then j.id::text when 'channel' then j.channel end end desc nulls last,
        j.created_at desc, j.id) as ord
      from j
  )
  select (select count(*) from j),
         coalesce(jsonb_agg(to_jsonb(r) - 'ord' order by r.ord), '[]'::jsonb)
    into v_total, v_rows
    from ranked r
   where r.ord > (v_page - 1) * v_size and r.ord <= v_page * v_size;

  return jsonb_build_object('total', coalesce(v_total, 0), 'rows', v_rows);
end $$;

-- filter options for Logs and Performance: templates used in the range
create or replace function public.comm_logs_options(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer
set search_path to ''
as $$
begin
  perform public.comm__guard(p_from, p_to, null, null);
  if p_from is null then raise exception 'range_required' using errcode = '22023'; end if;
  return jsonb_build_object('templates', coalesce((
    select jsonb_agg(t order by t)
      from (select distinct c.template_ref as t
              from public.comms_campaigns c
             where c.created_at >= p_from and c.created_at < p_to
               and c.template_ref is not null and btrim(c.template_ref) <> ''
             order by 1
             limit 200) x), '[]'::jsonb));
end $$;

-- one job (header, counts) + the e-mail subject when it is an e-mail job
create or replace function public.comm_log_get(p_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path to ''
as $$
declare v_job jsonb; v_subject text;
begin
  perform public.comm__guard(null, null, null, null);
  if p_id is null then raise exception 'id_required' using errcode = '22023'; end if;
  select to_jsonb(j) into v_job from public.comm__jobs(null, null, array[p_id]) j;
  if v_job is null then return jsonb_build_object('job', null, 'subject', null); end if;
  select e.subject into v_subject from public.email_events e
   where e.campaign_id = p_id and e.subject is not null order by e.sent_at limit 1;
  return jsonb_build_object('job', v_job, 'subject', v_subject);
end $$;

-- the people one job was sent to (Detailed Report), paged
create or replace function public.comm_log_recipients(
  p_id uuid, p_status text, p_from timestamptz, p_to timestamptz, p_search text, p_sort text, p_dir text,
  p_page int, p_size int)
returns jsonb
language plpgsql stable security definer
set search_path to ''
as $$
declare
  v_like text; v_sort text := coalesce(p_sort, 'date'); v_dir text := coalesce(p_dir, 'desc');
  v_page int := coalesce(p_page, 1); v_size int := coalesce(p_size, 10); v_total bigint; v_rows jsonb;
begin
  perform public.comm__guard(p_from, p_to, v_page, v_size);
  if p_id is null then raise exception 'id_required' using errcode = '22023'; end if;
  if p_status is not null and p_status not in ('Sent', 'Delivered', 'Read', 'Clicked', 'Failed') then
    raise exception 'status_invalid' using errcode = '22023'; end if;
  if v_sort not in ('date', 'status', 'contact') then raise exception 'sort_invalid' using errcode = '22023'; end if;
  if v_dir not in ('asc', 'desc') then raise exception 'dir_invalid' using errcode = '22023'; end if;
  v_like := public.comm__like(p_search);

  with x as (
    select m.rid, m.channel, m.contact, m.sent_at,
           case when m.is_failed then 'Failed' when m.is_clicked then 'Clicked' when m.is_read then 'Read'
                when m.is_delivered then 'Delivered' else 'Sent' end as status
      from public.comm__messages(array[p_id]) m
     where (p_from is null or (m.sent_at >= p_from and m.sent_at < p_to))
       and (v_like is null or m.contact ilike v_like)
  ), f as (
    select * from x where p_status is null or x.status = p_status
  ), ranked as (
    select f.*, row_number() over (order by
        case when v_dir = 'asc' and v_sort = 'date' then f.sent_at end asc nulls last,
        case when v_dir = 'desc' and v_sort = 'date' then f.sent_at end desc nulls last,
        case when v_dir = 'asc' then case v_sort when 'status' then f.status when 'contact' then f.contact end end asc nulls last,
        case when v_dir = 'desc' then case v_sort when 'status' then f.status when 'contact' then f.contact end end desc nulls last,
        f.sent_at desc nulls last, f.rid) as ord
      from f
  )
  select (select count(*) from f),
         coalesce(jsonb_agg(jsonb_build_object('rid', r.rid, 'channel', r.channel, 'contact', r.contact,
                                               'sent_at', r.sent_at, 'status', r.status) order by r.ord), '[]'::jsonb)
    into v_total, v_rows
    from ranked r
   where r.ord > (v_page - 1) * v_size and r.ord <= v_page * v_size;

  return jsonb_build_object('total', coalesce(v_total, 0), 'rows', v_rows);
end $$;

-- why part of a job failed (the ⓘ next to the status): at most 100 lines, no contact details
create or replace function public.comm_log_failures(p_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path to ''
as $$
begin
  perform public.comm__guard(null, null, null, null);
  if p_id is null then raise exception 'id_required' using errcode = '22023'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('rid', y.rid, 'reason', y.reason, 'at', y.sent_at) order by y.sent_at desc nulls last, y.rid)
      from (select m.rid, m.reason, m.sent_at
              from public.comm__messages(array[p_id]) m
             where m.is_failed
             order by m.sent_at desc nulls last, m.rid
             limit 100) y), '[]'::jsonb);
end $$;

-- ── Communication Performance ───────────────────────────────────────────────────
-- Counts only finished jobs (Completed / Closed / Failed / Undelivered); Scheduled and
-- In Progress jobs are listed in "basis" — same rule the screen already explains.
create or replace function public.comm_performance(p_from timestamptz, p_to timestamptz, p_channel text, p_template text)
returns jsonb
language plpgsql stable security definer
set search_path to ''
as $$
declare v jsonb;
begin
  perform public.comm__guard(p_from, p_to, null, null);
  if p_from is null then raise exception 'range_required' using errcode = '22023'; end if;
  if p_channel is not null and p_channel not in ('email', 'whatsapp') then raise exception 'channel_invalid' using errcode = '22023'; end if;
  if length(p_template) > 200 then raise exception 'template_too_long' using errcode = '22023'; end if;

  with j as (
    select * from public.comm__jobs(p_from, p_to, null) j
     where (p_channel is null or j.channel = p_channel)
       and (p_template is null or j.template = p_template)
  ), done as (
    select * from j where j.status in ('Completed', 'Closed', 'Failed', 'Undelivered')
  )
  select jsonb_build_object(
    'basis', jsonb_build_object(
      'matched', (select count(*) from j),
      'counted', (select count(*) from done),
      'scheduled', (select count(*) from j where j.status = 'Scheduled'),
      'in_progress', (select count(*) from j where j.status = 'In Progress')),
    'totals', (select jsonb_build_object('sent', coalesce(sum(d.sent), 0), 'delivered', coalesce(sum(d.delivered), 0),
                                         'read', coalesce(sum(d.read), 0), 'clicked', coalesce(sum(d.clicked), 0),
                                         'failed', coalesce(sum(d.failed), 0)) from done d),
    'by_channel', coalesce((select jsonb_agg(jsonb_build_object('channel', b.channel, 'sent', b.sent, 'delivered', b.delivered,
                                                                'read', b.read, 'clicked', b.clicked) order by b.channel)
                              from (select d.channel, sum(d.sent) sent, sum(d.delivered) delivered, sum(d.read) read, sum(d.clicked) clicked
                                      from done d group by d.channel) b), '[]'::jsonb),
    'by_day', coalesce((select jsonb_agg(jsonb_build_object('day', b.day, 'sent', b.sent, 'delivered', b.delivered) order by b.day)
                          from (select (d.created_at at time zone 'Asia/Kolkata')::date as day, sum(d.sent) sent, sum(d.delivered) delivered
                                  from done d group by 1) b), '[]'::jsonb))
    into v;
  return v;
end $$;

-- ── Suppressions ────────────────────────────────────────────────────────────────

create or replace function public.comm_suppressions_list(
  p_channel text, p_reason text, p_from timestamptz, p_to timestamptz, p_search text, p_sort text, p_dir text,
  p_page int, p_size int)
returns jsonb
language plpgsql stable security definer
set search_path to ''
as $$
declare
  v_like text; v_sort text := coalesce(p_sort, 'stamp'); v_dir text := coalesce(p_dir, 'desc');
  v_page int := coalesce(p_page, 1); v_size int := coalesce(p_size, 10); v_total bigint; v_rows jsonb;
begin
  perform public.comm__guard(p_from, p_to, v_page, v_size);
  if p_channel is null or p_channel not in ('Email', 'WhatsApp') then raise exception 'channel_invalid' using errcode = '22023'; end if;
  if p_reason is not null and p_reason not in ('Unsubscribe', 'Bounce', 'Block', 'Spam', 'Invalid') then
    raise exception 'reason_invalid' using errcode = '22023'; end if;
  if v_sort not in ('contact', 'stamp', 'keyword') then raise exception 'sort_invalid' using errcode = '22023'; end if;
  if v_dir not in ('asc', 'desc') then raise exception 'dir_invalid' using errcode = '22023'; end if;
  v_like := public.comm__like(p_search);

  with f as (
    select * from public.comm__optouts(p_channel) o
     where (p_reason is null or o.reason = p_reason)
       and (p_from is null or (o.at >= p_from and o.at < p_to))
       and (v_like is null or o.contact ilike v_like or o.source ilike v_like)
  ), ranked as (
    select f.*, row_number() over (order by
        case when v_dir = 'asc' and v_sort = 'stamp' then f.at end asc nulls last,
        case when v_dir = 'desc' and v_sort = 'stamp' then f.at end desc nulls last,
        case when v_dir = 'asc' then case v_sort when 'contact' then f.contact when 'keyword' then f.source end end asc nulls last,
        case when v_dir = 'desc' then case v_sort when 'contact' then f.contact when 'keyword' then f.source end end desc nulls last,
        f.at desc nulls last, f.id) as ord
      from f
  )
  select (select count(*) from f),
         coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'contact', r.contact, 'channel', p_channel, 'reason', r.reason,
                                               'source', r.source, 'at', r.at) order by r.ord), '[]'::jsonb)
    into v_total, v_rows
    from ranked r
   where r.ord > (v_page - 1) * v_size and r.ord <= v_page * v_size;

  return jsonb_build_object('total', coalesce(v_total, 0), 'rows', v_rows);
end $$;

create or replace function public.comm_suppressions_counts(p_channel text, p_from timestamptz, p_to timestamptz, p_search text)
returns jsonb
language plpgsql stable security definer
set search_path to ''
as $$
declare v_like text; v jsonb;
begin
  perform public.comm__guard(p_from, p_to, null, null);
  if p_channel is null or p_channel not in ('Email', 'WhatsApp') then raise exception 'channel_invalid' using errcode = '22023'; end if;
  v_like := public.comm__like(p_search);
  select jsonb_build_object(
           'Unsubscribe', count(*) filter (where o.reason = 'Unsubscribe'),
           'Bounce', count(*) filter (where o.reason = 'Bounce'),
           'Block', count(*) filter (where o.reason = 'Block'),
           'Spam', count(*) filter (where o.reason = 'Spam'),
           'Invalid', count(*) filter (where o.reason = 'Invalid'))
    into v
    from public.comm__optouts(p_channel) o
   where (p_from is null or (o.at >= p_from and o.at < p_to))
     and (v_like is null or o.contact ilike v_like or o.source ilike v_like);
  return v;
end $$;

-- ── grants ──────────────────────────────────────────────────────────────────────
-- private helpers: nobody calls them directly
revoke all on function public.comm__guard(timestamptz, timestamptz, int, int) from public, anon, authenticated;
revoke all on function public.comm__like(text) from public, anon, authenticated;
revoke all on function public.comm__messages(uuid[]) from public, anon, authenticated;
revoke all on function public.comm__jobs(timestamptz, timestamptz, uuid[]) from public, anon, authenticated;
revoke all on function public.comm__optouts(text) from public, anon, authenticated;

-- page functions: logged-in users may call; each one refuses non-admins inside
revoke all on function public.comm_logs_list(timestamptz, timestamptz, text, text, text, text, text, text, text, text, int, int) from public, anon;
revoke all on function public.comm_logs_options(timestamptz, timestamptz) from public, anon;
revoke all on function public.comm_log_get(uuid) from public, anon;
revoke all on function public.comm_log_recipients(uuid, text, timestamptz, timestamptz, text, text, text, int, int) from public, anon;
revoke all on function public.comm_log_failures(uuid) from public, anon;
revoke all on function public.comm_performance(timestamptz, timestamptz, text, text) from public, anon;
revoke all on function public.comm_suppressions_list(text, text, timestamptz, timestamptz, text, text, text, int, int) from public, anon;
revoke all on function public.comm_suppressions_counts(text, timestamptz, timestamptz, text) from public, anon;

grant execute on function public.comm_logs_list(timestamptz, timestamptz, text, text, text, text, text, text, text, text, int, int) to authenticated;
grant execute on function public.comm_logs_options(timestamptz, timestamptz) to authenticated;
grant execute on function public.comm_log_get(uuid) to authenticated;
grant execute on function public.comm_log_recipients(uuid, text, timestamptz, timestamptz, text, text, text, int, int) to authenticated;
grant execute on function public.comm_log_failures(uuid) to authenticated;
grant execute on function public.comm_performance(timestamptz, timestamptz, text, text) to authenticated;
grant execute on function public.comm_suppressions_list(text, text, timestamptz, timestamptz, text, text, text, int, int) to authenticated;
grant execute on function public.comm_suppressions_counts(text, timestamptz, timestamptz, text) to authenticated;

