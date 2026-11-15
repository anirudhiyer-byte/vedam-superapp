-- 0096 · Private Storage bucket for VSAT application file answers.
--
-- Students upload documents (marksheets, photo, certificates) against 'file'
-- questions in the active form. Files are PRIVATE: the bucket has no public read
-- policy, so browsers can never read objects directly. All writes/reads go through
-- the service-role API routes (/api/vsat/app-file [POST upload], [GET signed-url]),
-- which gate on the paid applicant (own files) or an admin (any). Per-question
-- allowed-types and max-size are enforced in the upload route from the form schema;
-- the bucket limits below are a backstop.
--
-- Rollback: supabase/rollback/0096_vsat_app_files_bucket_down.sql

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'vsat-app-files', 'vsat-app-files', false, 26214400,  -- 25 MiB cap (backstop)
  array[
    'application/pdf',
    'image/jpeg','image/png','image/webp','image/heic','image/heif',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- No storage.objects policies: RLS stays on with no grants, so the anon/authenticated
-- roles cannot read or write this bucket. Only the service role (API routes) can.
