-- Rollback for 0164_mock_launched_at.sql — drops the column.
alter table public.application_manager drop column if exists mock_launched_at;
