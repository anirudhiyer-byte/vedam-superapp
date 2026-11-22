-- 0103 · vsat_student_comms — documents + communication history for one applicant.
--
-- Companion to vsat_student (0080/0081): rather than grow that already-large function,
-- this returns the two things the admin applicant profile was missing — uploaded
-- documents and the full email/WhatsApp communication log — using the SAME access gate
-- (vsat__can_view) so nothing new is exposed. Both documents (Aadhaar / PAN / passport =
-- government IDs) and comms (contact + message content) are PII, so they are returned to
-- MANAGERS ONLY (vsat__can_manage); interviewers / counsellors get empty lists, exactly
-- like they get no contact details in vsat_student.
--
-- Security: SECURITY DEFINER + set search_path to '' ; RLS stays on with no table policies;
-- browsers reach this only through the function; execute is revoked from public/anon and
-- granted to authenticated. Read-only (STABLE), no writes.

create or replace function public.vsat_student_comms(p_application_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $fn$
declare
  am public.application_manager;
  mgr boolean;
  v_docs jsonb;
  v_comms jsonb;
  v_phone10 text;
begin
  if auth.uid() is null then raise exception 'NOT_SIGNED_IN' using errcode = '42501'; end if;
  if not public.vsat__can_view(p_application_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into am from public.application_manager where application_id = p_application_id;
  mgr := public.vsat__can_manage(public.vsat__campus_key(am.campus_applied));

  -- documents + comms carry PII (government IDs, contact, message content): managers only.
  if not mgr then
    return jsonb_build_object('can_manage', false, 'documents', '[]'::jsonb, 'comms', '[]'::jsonb);
  end if;

  -- uploaded documents: only the *_url columns that are actually filled, in a sensible order.
  v_docs := coalesce((
    select jsonb_agg(jsonb_build_object('key', k, 'label', lbl, 'url', u) order by ord)
    from (values
      ('photo',              'Photo',               am.photo_url,              1),
      ('aadhaar',            'Aadhaar',             am.aadhaar_url,            2),
      ('pan',                'PAN',                 am.pan_url,                3),
      ('passport',           'Passport',            am.passport_url,           4),
      ('class10_marksheet',  '10th marksheet',      am.class10_marksheet_url,  5),
      ('class12_marksheet',  '12th marksheet',      am.class12_marksheet_url,  6),
      ('entrance_scorecard', 'Entrance scorecard',  am.entrance_scorecard_url, 7),
      ('olympiad_cert',      'Olympiad certificate', am.olympiad_cert_url,     8),
      ('coding_cert',        'Coding certificate',  am.coding_cert_url,        9)
    ) as t(k, lbl, u, ord)
    where u is not null and btrim(u) <> ''
  ), '[]'::jsonb);

  v_phone10 := right(regexp_replace(coalesce(am.registered_mobile, ''), '\D', '', 'g'), 10);

  -- unified communication log: emails (email_events by auth user) + WhatsApp (whatsapp_sends
  -- matched on the last 10 phone digits, since numbers are stored with/without country code).
  -- Most recent first, capped so the payload can't blow up for a heavily-contacted lead.
  v_comms := coalesce((
    select jsonb_agg(c order by ts desc nulls last)
    from (
      select e.sent_at as ts,
             jsonb_build_object(
               'channel', 'email',
               'title', coalesce(nullif(e.subject, ''), e.kind, 'Email'),
               'kind', e.kind, 'status', e.status, 'at', e.sent_at,
               'delivered_at', e.delivered_at, 'opened_at', e.opened_at,
               'to', e.to_email, 'by', 'system') as c
      from public.email_events e
      where e.user_id = am.lead_id
      union all
      select w.created_at as ts,
             jsonb_build_object(
               'channel', 'whatsapp',
               'title', coalesce(nullif(w.campaign_name, ''), w.template_id, 'WhatsApp'),
               'template', w.template_id, 'status', w.status, 'at', w.created_at,
               'delivered_at', w.delivered_at, 'read_at', w.read_at,
               'failed_reason', w.failed_reason, 'to', w.to_number,
               'by', coalesce(pr.full_name, pr.email, 'system')) as c
      from public.whatsapp_sends w
      left join public.profiles pr on pr.id = w.sent_by
      where v_phone10 <> '' and right(regexp_replace(w.to_number, '\D', '', 'g'), 10) = v_phone10
      order by ts desc nulls last
      limit 200
    ) rows
  ), '[]'::jsonb);

  return jsonb_build_object('can_manage', true, 'documents', v_docs, 'comms', v_comms);
end $fn$;

revoke all on function public.vsat_student_comms(text) from public, anon;
grant execute on function public.vsat_student_comms(text) to authenticated;
