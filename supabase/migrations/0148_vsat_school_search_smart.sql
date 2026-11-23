-- 0148 · Smarter VSAT school search — abbreviation-aware, multi-token, punctuation-insensitive.
--
-- The dataset (school_database, ~14.5 lakh UDISE schools) was always complete; the old
-- vsat_school_search (0042) did a single ILIKE '%q%' on the FORMAL schname only. So a student
-- typing "KV", "DPS", "DAV" or a two-word query like "DPS Delhi" got nothing, because UDISE
-- stores the spelled-out names ("KENDRIYA VIDYALAYA…", "DELHI PUBLIC SCHOOL…", "D.A.V.…") and a
-- substring match can't bridge the abbreviation or span two words.
--
-- This replaces the search with: (1) expand common abbreviations, (2) match against a COMPACT
-- form of schname + district + state (lowercased, every non-alphanumeric removed — so "D.A.V."
-- and "DAV" both become "dav"), and (3) require EVERY query token to be present (so "DPS Delhi"
-- = Delhi Public School AND Delhi). A GIN trigram index on the same compact expression keeps the
-- type-ahead fast on 1.45M rows. CREATE OR REPLACE only — no schema/ownership change.
--
-- Rollback: supabase/rollback/0148_vsat_school_search_smart_down.sql
-- Tests:    supabase/tests/vsat_school_search.test.sql
--
-- NOTE for the prod cutover: building the index below on 1.45M rows takes a short while and
-- briefly locks writes on school_database (a read-only reference table), which is acceptable.

create extension if not exists pg_trgm;

-- compact searchable text: schname + district + state, lowercased, all non-alphanumerics removed
create index if not exists school_database_compact_trgm on public.school_database using gin (
  lower(regexp_replace(
    coalesce(schname,'')||' '||coalesce(dtname,'')||' '||coalesce(dtname_1,'')||' '||coalesce(stname,'')||' '||coalesce(stname_1,''),
    '[^A-Za-z0-9]+', '', 'g')) gin_trgm_ops
);

create or replace function public.vsat_school_search(p jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $fn$
declare
  v_q text; v_lim int; v_rows jsonb; k text; v_norm text; v_toks text[]; v_pats text[]; v_like text[]; v_longest text;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'code', 'UNAUTHENTICATED'); end if;
  if p is null or jsonb_typeof(p) <> 'object' then return jsonb_build_object('ok', false, 'code', 'INVALID'); end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('q','limit') then return jsonb_build_object('ok', false, 'code', 'INVALID'); end if;
  end loop;
  v_q := btrim(coalesce(p->>'q',''));
  if char_length(v_q) < 2 then return jsonb_build_object('ok', true, 'schools', '[]'::jsonb); end if;
  v_lim := least(greatest(coalesce((p->>'limit')::int, 20), 1), 30);

  -- normalise: lowercase, non-alphanumerics -> single space, trim, pad with spaces for token replace
  v_norm := lower(v_q);
  v_norm := regexp_replace(v_norm, '[^a-z0-9]+', ' ', 'g');
  v_norm := ' ' || btrim(regexp_replace(v_norm, '\s+', ' ', 'g')) || ' ';
  -- dotted single-letter abbreviations typed with spaces ("d a v" / "k v")
  v_norm := replace(v_norm, ' d a v ', ' dav ');
  v_norm := replace(v_norm, ' k v ',   ' kv ');
  -- expand common abbreviations to their spelled-out COMPACT form (matches the compact text below)
  v_norm := replace(v_norm, ' dps ',  ' delhipublicschool ');
  v_norm := replace(v_norm, ' kvs ',  ' kendriyavidyalaya ');
  v_norm := replace(v_norm, ' kv ',   ' kendriyavidyalaya ');
  v_norm := replace(v_norm, ' jnv ',  ' jawaharnavodayavidyalaya ');
  v_norm := replace(v_norm, ' nvs ',  ' navodayavidyalaya ');
  v_norm := replace(v_norm, ' aps ',  ' armypublicschool ');
  v_norm := btrim(v_norm);

  -- tokens -> required compact substrings (drop single chars unless that is all there is)
  v_toks := regexp_split_to_array(v_norm, '\s+');
  select array_agg(t) into v_pats from unnest(v_toks) t where char_length(t) >= 2;
  if v_pats is null then select array_agg(t) into v_pats from unnest(v_toks) t where char_length(t) >= 1; end if;
  if v_pats is null or array_length(v_pats,1) is null then return jsonb_build_object('ok', true, 'schools', '[]'::jsonb); end if;
  select array_agg('%'||pp||'%') into v_like from unnest(v_pats) pp;          -- LIKE patterns, evaluated once
  select t into v_longest from unnest(v_pats) t order by char_length(t) desc limit 1;  -- most selective token drives the index

  select coalesce(jsonb_agg(jsonb_build_object('code', schcd, 'name', schname, 'district', dist, 'state', st) order by rnk), '[]'::jsonb)
  into v_rows from (
    select s.schcd, s.schname,
           coalesce(nullif(s.dtname,''), s.dtname_1) dist,
           coalesce(nullif(s.stname,''), s.stname_1) st,
           row_number() over (order by
             (lower(regexp_replace(coalesce(s.schname,''),'[^A-Za-z0-9]+','','g')) like v_longest || '%') desc,
             length(s.schname), s.schname) rnk
    from public.school_database s
    where s.schname is not null
      -- index-driven: the longest token on the compact text
      and lower(regexp_replace(coalesce(s.schname,'')||' '||coalesce(s.dtname,'')||' '||coalesce(s.dtname_1,'')||' '||coalesce(s.stname,'')||' '||coalesce(s.stname_1,''),'[^A-Za-z0-9]+','','g')) like '%'||v_longest||'%'
      -- correctness: every token must be present on the compact text
      and lower(regexp_replace(coalesce(s.schname,'')||' '||coalesce(s.dtname,'')||' '||coalesce(s.dtname_1,'')||' '||coalesce(s.stname,'')||' '||coalesce(s.stname_1,''),'[^A-Za-z0-9]+','','g')) like all (v_like)
    order by rnk
    limit v_lim
  ) q;

  return jsonb_build_object('ok', true, 'schools', v_rows);
end $fn$;

revoke all on function public.vsat_school_search(jsonb) from public, anon;
grant execute on function public.vsat_school_search(jsonb) to authenticated;
