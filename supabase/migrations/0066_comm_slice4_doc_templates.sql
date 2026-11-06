-- 0066 · Communication Manager, Slice 4 — Manage Document Templates (Template Manager, page 1 of 2).
--
-- Admins create, edit and (soft) delete document templates. The HTML is cleaned in the API route first
-- (sanitize-html allowlist, src/app/api/admin/comm/_lib/doc-sanitize.ts); the database checks it AGAIN
-- here as a second line of defence and refuses anything outside the safe subset. Templates hold no
-- personal data: merge fields are placeholders only.
--
-- New objects only. Nothing existing is altered or replaced (the existing audit_trigger(), comm__guard()
-- and comm__like() are only called / referenced).
--   * table comm_doc_templates: RLS on, no policies, all privileges revoked from public/anon/authenticated,
--     existing audit_trigger() attached (create / update / delete land in audit_log).
--   * comm__doc_html_check(html) → merge fields used. Private helper (not definer, not callable by
--     anon/authenticated). Refuses (22023): empty, > 100 KB, any tag outside the allowlist, any attribute
--     other than colspan/rowspan (td/th, 1–20) and style, on* handlers, javascript:/vbscript:, data:/url(/
--     expression(/@import/backslash or any "&" inside a tag, a style property outside the same 8-property
--     allowlist as the route (text-align, font-weight, font-style, text-decoration, margin, padding, width,
--     border — strict value patterns), comments / <! / <?, a stray "<", unknown or broken merge fields.
--   * page functions (SECURITY DEFINER, search_path '', comm__guard first = admin only, owner-or-admin for changes):
--       comm_doc_template_list(search, page, size)        – live templates, newest first (no HTML in the list)
--       comm_doc_template_get(id)                         – one template with its HTML (P0002 if missing / deleted)
--       comm_doc_template_create(name, html, dry_run)     – dry_run = true runs every check and writes nothing
--                                                           ("Check and preview"); max 200 live templates
--       comm_doc_template_update(id, name, html)          – null = keep; P0002 if missing / deleted
--       comm_doc_template_delete(id)                      – soft delete (deleted_at)
--
-- Rollback: supabase/rollback/0066_comm_slice4_doc_templates_down.sql
-- Tests:    supabase/tests/comm_slice4_doc_templates.test.sql (staging only, rolls itself back)

-- ── table ───────────────────────────────────────────────────────────────────────
create table if not exists public.comm_doc_templates (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (char_length(btrim(name)) between 1 and 80 and name !~ '[[:cntrl:]]'),
  html          text not null check (octet_length(html) <= 102400 and btrim(html) <> ''),
  merge_fields  text[] not null default '{}'
                check (merge_fields <@ array['first_name', 'full_name', 'vsat_id', 'campus', 'today']::text[]),
  owner_id      uuid not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index if not exists comm_doc_templates_live_created_idx on public.comm_doc_templates (created_at desc) where deleted_at is null;

alter table public.comm_doc_templates enable row level security;
revoke all on table public.comm_doc_templates from public, anon, authenticated;

create trigger trg_audit_comm_doc_templates
  after insert or update or delete on public.comm_doc_templates
  for each row execute function public.audit_trigger();

-- ── second line of defence: is this already-cleaned HTML inside the safe subset? ──────────
create or replace function public.comm__doc_html_check(p_html text)
returns text[]
language plpgsql immutable
set search_path to ''
as $$
declare
  v_inner text; v_name text; v_n_lt int; v_n_tags int := 0; v_fields text[];
  v_style text; v_decl text; v_prop text; v_val text; v_ok boolean;
  c_tags constant text[] := array['p', 'h1', 'h2', 'h3', 'h4', 'br', 'hr', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li',
                                  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'div', 'blockquote'];
  c_field constant text := '\{\{(first_name|full_name|vsat_id|campus|today)\}\}';
  -- the same style allowlist and value patterns as the route's sanitiser (doc-sanitize.ts)
  c_len constant text := '(0|[0-9]{1,4}(\.[0-9]{1,2})?(px|em|rem|%|pt))';
begin
  if p_html is null or btrim(p_html) = '' then raise exception 'html_required' using errcode = '22023'; end if;
  if octet_length(p_html) > 102400 then raise exception 'html_too_big' using errcode = '22023'; end if;
  if p_html ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]' then raise exception 'html_unsafe' using errcode = '22023'; end if;

  -- anywhere in the text
  if p_html ~* 'java\s*script\s*:|vb\s*script\s*:' or p_html ~ '<!|<\?' then
    raise exception 'html_unsafe' using errcode = '22023';
  end if;

  -- every tag: allowed name, allowed attributes only, nothing dangerous inside
  for v_inner in select m[1] from regexp_matches(p_html, '<([^<>]*)>', 'g') as m loop
    v_n_tags := v_n_tags + 1;
    v_name := lower(substring(v_inner from '^/?([A-Za-z0-9]+)'));
    if v_name is null or not (v_name = any (c_tags)) then raise exception 'html_unsafe' using errcode = '22023'; end if;
    if v_inner ~* '(url|expression)\s*\(|@import|data\s*:|\\|on[a-z]+\s*=' then raise exception 'html_unsafe' using errcode = '22023'; end if;
    if v_inner !~* '^/?[a-z0-9]+(\s+(colspan|rowspan)="([1-9]|1[0-9]|20)"|\s+style="[^"<>]*")*\s*/?$' then
      raise exception 'html_unsafe' using errcode = '22023';
    end if;
    if v_inner ~* '\s(colspan|rowspan)=' and v_name not in ('td', 'th') then raise exception 'html_unsafe' using errcode = '22023'; end if;
    -- no entities inside a tag at all (the cleaner never writes one there), so nothing can be hidden as &#117;rl( etc.
    if strpos(v_inner, '&') > 0 then raise exception 'html_unsafe' using errcode = '22023'; end if;
    -- style: only the 8 allowed properties, each value matching its strict pattern
    for v_style in select m[1] from regexp_matches(v_inner, '\sstyle="([^"]*)"', 'gi') as m loop
      for v_decl in select btrim(x) from regexp_split_to_table(v_style, ';') as x loop
        continue when v_decl = '';
        if strpos(v_decl, ':') = 0 then raise exception 'html_unsafe' using errcode = '22023'; end if;
        v_prop := lower(btrim(split_part(v_decl, ':', 1)));
        v_val := regexp_replace(btrim(substr(v_decl, strpos(v_decl, ':') + 1)), '\s*!important$', '', 'i');
        v_ok := case v_prop
          when 'text-align'      then v_val ~* '^(left|right|center|justify)$'
          when 'font-weight'     then v_val ~* '^(normal|bold|bolder|lighter|[1-9]00)$'
          when 'font-style'      then v_val ~* '^(normal|italic|oblique)$'
          when 'text-decoration' then v_val ~* '^(none|underline|line-through|overline)$'
          when 'margin'  then v_val ~* ('^(auto|-?' || c_len || ')(\s+(auto|-?' || c_len || ')){0,3}$')
          when 'padding' then v_val ~* ('^' || c_len || '(\s+' || c_len || '){0,3}$')
          when 'width'   then v_val ~* ('^(auto|' || c_len || ')$')
          when 'border'  then v_val ~* '^(none|0|([0-9]{1,2}(px|pt)\s+)?(solid|dashed|dotted|double)(\s+(#[0-9a-f]{3}|#[0-9a-f]{6}|black|gray|grey|silver|white))?)$'
          else false end;
        if not v_ok then raise exception 'html_unsafe' using errcode = '22023'; end if;
      end loop;
    end loop;
  end loop;
  -- every "<" must start one of those tags (text "<" is always escaped by the cleaner)
  v_n_lt := length(p_html) - length(replace(p_html, '<', ''));
  if v_n_lt <> v_n_tags then raise exception 'html_unsafe' using errcode = '22023'; end if;

  -- merge fields: only the five, written exactly; no stray or triple braces
  if regexp_replace(p_html, c_field, '', 'g') ~ '\{\{|\}\}' or p_html ~ '\{\{\{|\}\}\}' then
    raise exception 'merge_field_unknown' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct m[1] order by m[1]), '{}') into v_fields from regexp_matches(p_html, c_field, 'g') as m;
  return v_fields;
end $$;

-- ── list (no HTML) ──────────────────────────────────────────────────────────────
create or replace function public.comm_doc_template_list(p_search text, p_page int, p_size int)
returns jsonb
language plpgsql stable security definer
set search_path to ''
as $$
declare v_like text; v_page int := coalesce(p_page, 1); v_size int := coalesce(p_size, 10); v_total bigint; v_rows jsonb;
begin
  perform public.comm__guard(null, null, v_page, v_size);
  v_like := public.comm__like(p_search);
  select count(*) into v_total from public.comm_doc_templates t where t.deleted_at is null and (v_like is null or t.name ilike v_like);
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'merge_fields', to_jsonb(x.merge_fields), 'size', x.size,
                                               'owner_is_me', x.owner_id = auth.uid(), 'created_at', x.created_at,
                                               'updated_at', x.updated_at) order by x.created_at desc, x.id), '[]'::jsonb)
    into v_rows
    from (select t.id, t.name, t.merge_fields, octet_length(t.html) as size, t.owner_id, t.created_at, t.updated_at
            from public.comm_doc_templates t
           where t.deleted_at is null and (v_like is null or t.name ilike v_like)
           order by t.created_at desc, t.id
           limit v_size offset (v_page - 1) * v_size) x;
  return jsonb_build_object('total', v_total, 'rows', v_rows);
end $$;

-- ── one template with its HTML ───────────────────────────────────────────────────
create or replace function public.comm_doc_template_get(p_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path to ''
as $$
declare v public.comm_doc_templates;
begin
  perform public.comm__guard(null, null, null, null);
  if p_id is null then raise exception 'id_required' using errcode = '22023'; end if;
  select * into v from public.comm_doc_templates t where t.id = p_id and t.deleted_at is null;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  return jsonb_build_object('id', v.id, 'name', v.name, 'html', v.html, 'merge_fields', to_jsonb(v.merge_fields),
                            'size', octet_length(v.html), 'owner_is_me', v.owner_id = auth.uid(),
                            'created_at', v.created_at, 'updated_at', v.updated_at);
end $$;

-- ── create (dry_run = check only, nothing written) ──────────────────────────────────
create or replace function public.comm_doc_template_create(p_name text, p_html text, p_dry_run boolean default false)
returns jsonb
language plpgsql volatile security definer
set search_path to ''
as $$
declare v public.comm_doc_templates; v_fields text[];
begin
  perform public.comm__guard(null, null, null, null);
  if p_name is null or char_length(btrim(p_name)) not between 1 and 80 or p_name ~ '[[:cntrl:]]' then
    raise exception 'name_invalid' using errcode = '22023';
  end if;
  v_fields := public.comm__doc_html_check(p_html);
  if coalesce(p_dry_run, false) then
    return jsonb_build_object('dry_run', true, 'merge_fields', to_jsonb(v_fields), 'size', octet_length(p_html));
  end if;
  if (select count(*) from public.comm_doc_templates t where t.deleted_at is null) >= 200 then
    raise exception 'too_many_templates' using errcode = '22023';
  end if;
  insert into public.comm_doc_templates (name, html, merge_fields, owner_id)
  values (btrim(p_name), p_html, v_fields, auth.uid())
  returning * into v;
  return jsonb_build_object('id', v.id, 'name', v.name, 'merge_fields', to_jsonb(v.merge_fields), 'size', octet_length(v.html),
                            'owner_is_me', true, 'created_at', v.created_at, 'updated_at', v.updated_at, 'dry_run', false);
end $$;

-- ── update (null = keep) ─────────────────────────────────────────────────────────
create or replace function public.comm_doc_template_update(p_id uuid, p_name text, p_html text)
returns jsonb
language plpgsql volatile security definer
set search_path to ''
as $$
declare v public.comm_doc_templates; v_fields text[];
begin
  perform public.comm__guard(null, null, null, null);
  if p_id is null then raise exception 'id_required' using errcode = '22023'; end if;
  if p_name is not null and (char_length(btrim(p_name)) not between 1 and 80 or p_name ~ '[[:cntrl:]]') then
    raise exception 'name_invalid' using errcode = '22023';
  end if;
  if p_html is not null then v_fields := public.comm__doc_html_check(p_html); end if;
  select * into v from public.comm_doc_templates t where t.id = p_id and t.deleted_at is null for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not (v.owner_id = auth.uid() or public.is_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.comm_doc_templates t
     set name = coalesce(btrim(p_name), t.name),
         html = coalesce(p_html, t.html),
         merge_fields = coalesce(v_fields, t.merge_fields),
         updated_at = now()
   where t.id = p_id
  returning * into v;
  return jsonb_build_object('id', v.id, 'name', v.name, 'merge_fields', to_jsonb(v.merge_fields), 'size', octet_length(v.html),
                            'owner_is_me', v.owner_id = auth.uid(), 'created_at', v.created_at, 'updated_at', v.updated_at);
end $$;

-- ── soft delete ─────────────────────────────────────────────────────────────────
create or replace function public.comm_doc_template_delete(p_id uuid)
returns jsonb
language plpgsql volatile security definer
set search_path to ''
as $$
declare v public.comm_doc_templates;
begin
  perform public.comm__guard(null, null, null, null);
  if p_id is null then raise exception 'id_required' using errcode = '22023'; end if;
  select * into v from public.comm_doc_templates t where t.id = p_id and t.deleted_at is null for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if not (v.owner_id = auth.uid() or public.is_admin()) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.comm_doc_templates t set deleted_at = now(), updated_at = now() where t.id = p_id;
  return jsonb_build_object('id', p_id, 'deleted', true);
end $$;

-- ── grants ──────────────────────────────────────────────────────────────────────
revoke all on function public.comm__doc_html_check(text) from public, anon, authenticated;

revoke all on function public.comm_doc_template_list(text, int, int) from public, anon;
revoke all on function public.comm_doc_template_get(uuid) from public, anon;
revoke all on function public.comm_doc_template_create(text, text, boolean) from public, anon;
revoke all on function public.comm_doc_template_update(uuid, text, text) from public, anon;
revoke all on function public.comm_doc_template_delete(uuid) from public, anon;

grant execute on function public.comm_doc_template_list(text, int, int) to authenticated;
grant execute on function public.comm_doc_template_get(uuid) to authenticated;
grant execute on function public.comm_doc_template_create(text, text, boolean) to authenticated;
grant execute on function public.comm_doc_template_update(uuid, text, text) to authenticated;
grant execute on function public.comm_doc_template_delete(uuid) to authenticated;
