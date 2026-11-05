-- 0064 · Communication Manager, Slice 2 — Suppressions: Add one contact, Remove a manual entry.
--
-- What this adds (nothing existing is changed: no ALTER, no new grant on an existing object,
-- no create-or-replace of an existing function):
--   * table comm_suppression_meta (who added a manual suppression, an optional note, when).
--     No FK to existing tables. RLS on, no policies, no table access for anon/authenticated.
--     The existing audit_trigger() is attached, like comm_lists in 0061.
--   * comm_suppression_add(channel, contact, category, note)  — one contact per call
--   * comm_suppression_remove(id, reason)                      — manual entries only, reason 10–200 chars
--     Both: SECURITY DEFINER, search_path '', admin check first (comm__guard from 0060),
--     execute revoked from public/anon and granted to authenticated, one explicit audit_log row each.
--
-- How it stays in step with the existing opt-out code:
--   * the insert is done by the EXISTING public.comms_opt_out() (same lower-casing, same user lookup,
--     same unique index uq_optout, on conflict do nothing). We only clean the input first:
--       e-mail → lower(btrim(x));  WhatsApp → 91XXXXXXXXXX (comm__phone91 from 0061, the format
--       whatsapp_sends.to_number and the STOP webhook use).
--   * "already suppressed?" is decided by the EXISTING public.is_opted_out(), the same check the e-mail
--     send path uses, so a contact covered by a channel row or an 'all' row is reported, not duplicated.
--   * the category is stored as reason text that the 0060 label logic (comm__optouts) already sorts into
--     the same tab: 'Bounce (added in admin panel)' → Bounce, etc. 0060 is NOT changed.
--     WhatsApp has one list in the page (Opt-Out), so WhatsApp accepts only 'Unsubscribe'.
--
-- Locked: STOP replies, unsubscribe links, bounces and any row not added through comm_suppression_add have
-- no comm_suppression_meta row and are refused by remove (errcode 55000 → API 409 LOCKED).
--
-- Rollback: supabase/rollback/0064_comm_slice2_suppressions_down.sql
-- Tests:    supabase/tests/comm_slice2_suppressions.test.sql (staging only, rolls itself back)

-- ── table ───────────────────────────────────────────────────────────────────────
create table if not exists public.comm_suppression_meta (
  optout_id   uuid primary key,                -- comms_optouts.id (no FK on purpose: existing tables stay untouched)
  added_by    uuid not null,
  note        text check (note is null or (char_length(note) between 1 and 200 and note !~ '[[:cntrl:]]')),
  created_at  timestamptz not null default now()
);

alter table public.comm_suppression_meta enable row level security;
revoke all on table public.comm_suppression_meta from public, anon, authenticated;

create trigger trg_audit_comm_suppression_meta
  after insert or update or delete on public.comm_suppression_meta
  for each row execute function public.audit_trigger();

-- ── add ─────────────────────────────────────────────────────────────────────────
-- p_channel 'Email' | 'WhatsApp'; p_category 'Unsubscribe' | 'Bounce' | 'Block' | 'Spam' | 'Invalid'
-- (WhatsApp: 'Unsubscribe' only); p_note optional, 1–200 chars after trimming, no control characters.
-- Returns {id, status: 'added' | 'already', channel, category, contact (cleaned)}.
create or replace function public.comm_suppression_add(p_channel text, p_contact text, p_category text, p_note text)
returns jsonb
language plpgsql volatile security definer
set search_path to ''
as $$
declare
  v_ch text; v_email text; v_phone text; v_contact text; v_note text; v_reason text; v_id uuid;
begin
  perform public.comm__guard(null, null, null, null);

  if p_channel is null or p_channel not in ('Email', 'WhatsApp') then
    raise exception 'channel_invalid' using errcode = '22023';
  end if;
  if p_category is null or p_category not in ('Unsubscribe', 'Bounce', 'Block', 'Spam', 'Invalid')
     or (p_channel = 'WhatsApp' and p_category <> 'Unsubscribe') then
    raise exception 'category_invalid' using errcode = '22023';
  end if;
  if p_contact is null or char_length(p_contact) > 254 or p_contact ~ '[[:cntrl:]]' then
    raise exception 'contact_invalid' using errcode = '22023';
  end if;
  if p_note is not null then
    if char_length(p_note) > 400 then raise exception 'note_invalid' using errcode = '22023'; end if;
    v_note := nullif(btrim(p_note), '');
    if v_note is not null and (char_length(v_note) > 200 or v_note ~ '[[:cntrl:]]') then
      raise exception 'note_invalid' using errcode = '22023';
    end if;
  end if;

  if p_channel = 'Email' then
    v_ch := 'email';
    v_email := lower(btrim(p_contact));
    if v_email !~ '^[^@[:space:],;]+@[^@[:space:],;]+\.[^@[:space:],;.]{2,}$' then
      raise exception 'contact_invalid' using errcode = '22023';
    end if;
    v_contact := v_email;
  else
    v_ch := 'whatsapp';
    if btrim(p_contact) !~ '^\+?[0-9 ()-]{10,20}$' then
      raise exception 'contact_invalid' using errcode = '22023';
    end if;
    v_phone := public.comm__phone91(p_contact);
    if v_phone is null then raise exception 'contact_invalid' using errcode = '22023'; end if;
    v_contact := v_phone;
  end if;

  v_reason := case
                when v_ch = 'whatsapp' then 'Opt-out (added in admin panel)'
                else p_category || ' (added in admin panel)'
              end;

  -- one add per contact+channel at a time
  perform pg_advisory_xact_lock(hashtextextended('comm_suppression:' || v_ch || ':' || v_contact, 0));

  -- already suppressed (a row for this channel, or an 'all' row)? decided by the existing check
  if public.is_opted_out(v_email, v_phone, v_ch) then
    select o.id into v_id
      from public.comms_optouts o
     where (o.channel = v_ch or o.channel = 'all')
       and ((v_email is not null and lower(o.email) = v_email) or (v_phone is not null and o.phone = v_phone))
     order by (o.channel = v_ch) desc, o.opted_out_at nulls last, o.id
     limit 1;
    return jsonb_build_object('id', v_id, 'status', 'already', 'channel', p_channel, 'contact', v_contact);
  end if;

  -- the existing writer inserts the row (same normalising, same unique index, on conflict do nothing)
  perform public.comms_opt_out(v_email, v_phone, v_ch, v_reason);

  select o.id into v_id
    from public.comms_optouts o
   where coalesce(o.email, '') = coalesce(v_email, '') and coalesce(o.phone, '') = coalesce(v_phone, '') and o.channel = v_ch;
  if v_id is null then raise exception 'add_failed'; end if;

  insert into public.comm_suppression_meta (optout_id, added_by, note) values (v_id, auth.uid(), v_note);
  insert into public.audit_log (actor_id, action, table_name, record_id, new_data)
  values (auth.uid(), 'comm_suppression_add', 'comms_optouts', v_id::text,
          jsonb_build_object('channel', p_channel, 'category', p_category, 'note', v_note));

  return jsonb_build_object('id', v_id, 'status', 'added', 'channel', p_channel, 'category', p_category, 'contact', v_contact);
end $$;

-- ── remove ──────────────────────────────────────────────────────────────────────
-- Only rows added through comm_suppression_add (they have a comm_suppression_meta row). Any admin may remove
-- any manual row, but always with a reason of 10–200 characters (stored in audit_log).
-- Unknown id → P0002. Not a manual row (STOP / unsubscribe link / bounce / webhook) → 55000 'locked'.
create or replace function public.comm_suppression_remove(p_id uuid, p_reason text)
returns jsonb
language plpgsql volatile security definer
set search_path to ''
as $$
declare v_o public.comms_optouts; v_m public.comm_suppression_meta; v_reason text;
begin
  perform public.comm__guard(null, null, null, null);
  if p_id is null then raise exception 'id_required' using errcode = '22023'; end if;
  if p_reason is null or char_length(p_reason) > 400 then raise exception 'reason_invalid' using errcode = '22023'; end if;
  v_reason := btrim(p_reason);
  if char_length(v_reason) < 10 or char_length(v_reason) > 200 or v_reason ~ '[[:cntrl:]]' then
    raise exception 'reason_invalid' using errcode = '22023';
  end if;

  select * into v_o from public.comms_optouts o where o.id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into v_m from public.comm_suppression_meta m where m.optout_id = p_id for update;
  if not found then
    raise exception 'locked' using errcode = '55000', hint = 'Only entries added in the admin panel can be removed here.';
  end if;

  delete from public.comms_optouts o where o.id = p_id;
  delete from public.comm_suppression_meta m where m.optout_id = p_id;
  insert into public.audit_log (actor_id, action, table_name, record_id, old_data, new_data)
  values (auth.uid(), 'comm_suppression_remove', 'comms_optouts', p_id::text,
          jsonb_build_object('channel', v_o.channel, 'reason', v_o.reason, 'added_by', v_m.added_by, 'added_at', v_m.created_at),
          jsonb_build_object('remove_reason', v_reason, 'removed_by_adder', v_m.added_by = auth.uid()));

  return jsonb_build_object('id', p_id, 'removed', true);
end $$;

-- ── grants ──────────────────────────────────────────────────────────────────────
revoke all on function public.comm_suppression_add(text, text, text, text) from public, anon;
revoke all on function public.comm_suppression_remove(uuid, text) from public, anon;
grant execute on function public.comm_suppression_add(text, text, text, text) to authenticated;
grant execute on function public.comm_suppression_remove(uuid, text) to authenticated;
