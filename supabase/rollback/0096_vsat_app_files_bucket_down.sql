-- Rollback for 0096_vsat_app_files_bucket.sql
-- Removes the private vsat-app-files bucket. Guarded: refuses if it still holds
-- objects (so rolling back never silently deletes submitted student documents).
-- Supabase's storage.protect_delete() trigger blocks direct SQL deletes of
-- storage rows, so we bypass triggers for this transaction only. If any objects
-- exist, empty the bucket via the Storage API/dashboard first, then run this.
do $$
begin
  if exists (select 1 from storage.objects where bucket_id = 'vsat-app-files') then
    raise exception 'vsat-app-files bucket is not empty — remove objects via the Storage API before rolling back';
  end if;
  set local session_replication_role = 'replica';  -- bypass storage.protect_delete for this tx
  delete from storage.buckets where id = 'vsat-app-files';
  set local session_replication_role = 'origin';
end $$;
