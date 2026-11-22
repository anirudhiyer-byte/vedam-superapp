-- Rollback 0143 · drop the source-split functions and bucket helper.
drop function if exists public.ins_source_split(text, timestamptz, timestamptz, uuid);
drop function if exists public.ins_vsats();
drop function if exists public.ins__bucket(text, text);
