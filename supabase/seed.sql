-- Local development seed. Applied automatically by `supabase db reset`
-- and `supabase start`. NEVER applied to a hosted project.
--
-- WHY THIS FILE EXISTS
--
-- The migrations in this repository create tables but never GRANT on them. On a
-- hosted Supabase project that works, because the platform ships default
-- privileges granting `anon`, `authenticated` and `service_role` full DML on
-- new objects in `public`, with RLS as the actual access control.
--
-- Recent Supabase local stacks do NOT carry that default. A freshly started
-- local stack therefore rejects every query with:
--
--     permission denied for table users
--
-- which is what made the RLS / tenant-isolation suites unrunnable locally, and
-- is why they had been self-skipping since they were written. Restoring the
-- platform's grants here is what lets them execute:
--
--     SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
--       pnpm --filter api test
--
-- This is a LOCAL WORKAROUND, not the fix. The real defect is that the schema
-- is not self-contained: a restore into a fresh project would hit exactly this
-- wall. Tracked as SD-1 in VISAAIDocs/technical-debt/task-14-technical-debt.md.
--
-- Note what this does NOT do: it does not weaken RLS. Row-level security stays
-- enabled on all 127 tables with all 140 policies; these are table-level GRANTs,
-- which RLS then filters. That is precisely the hosted arrangement, which is why
-- an isolation test run against this stack is meaningful.

grant usage on schema public to anon, authenticated, service_role;

grant all on all tables    in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant all on all functions in schema public to anon, authenticated, service_role;

alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- SEC (Master Security Audit 2026-08-16): re-assert the production security
-- posture that the blanket grants above just wiped out.
--
-- On hosted Supabase these objects are locked down by explicit REVOKEs in the
-- migrations (SECURITY DEFINER RPCs that must not be callable by anon/
-- authenticated; internal margin data that must not be world-readable). The
-- local shim above grants EVERYTHING to anon/authenticated to mimic the hosted
-- default privileges — but it also undoes those REVOKEs, leaving the local/CI
-- stack MORE permissive than production and hiding the very controls the
-- security suites exist to verify. Re-run the revokes here so local == prod.
do $$
declare fn text; sig text;
  locked_fns text[] := array[
    'audit_append','audit_verify_chain','audit_no_mutate',
    'field_provenance_create_version','claim_outbox_batch',
    'bump_delivery_attempt','consume_review_credit','redeem_coupon',
    'enqueue_application_status_changed','refresh_consultant_rating',
    -- pre-existing prod revokes the blanket grant also undoes locally:
    'cleanup_stale_anonymous_users','ensure_month_partition',
    'increment_partner_usage'
  ];
begin
  foreach fn in array locked_fns loop
    for sig in
      select p.oid::regprocedure::text from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.proname = fn
    loop
      execute format('revoke all on function %s from public, anon, authenticated', sig);
      execute format('grant execute on function %s to service_role', sig);
    end loop;
  end loop;
end $$;

-- SEC-4092: internal pricing margin/COGS is not public.
revoke select on public.pricing_quotes from anon;
