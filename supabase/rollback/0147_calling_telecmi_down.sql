-- Rollback 0147 · drop the TeleCMI telephony integration (all objects are new in 0147).
drop function if exists public.calling_telecmi_ingest(jsonb);
drop function if exists public.calling_set_telecmi_agent(jsonb);
drop function if exists public.calling_telecmi_roster();
drop function if exists public.calling_lead_calls(jsonb);
drop function if exists public.calling_recording_ok(jsonb);
drop function if exists public.calling_telecmi_log_attempt(jsonb);
drop function if exists public.calling_telecmi_prepare(jsonb);
drop function if exists public.calling_telecmi_on();

drop table if exists public.calling_call_events;
drop table if exists public.calling_telecmi_agents;

drop function if exists public.calling_dial(text);
delete from public.app_flags where key = 'telecmi_enabled';
