-- Rollback of 0129_insights_funnel.sql: drops the one read-only function it added. Nothing else used it
-- in the database; the Insights page only shows the two new cards when the call succeeds.
drop function if exists public.ins_funnel(timestamptz, timestamptz);
