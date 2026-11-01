-- =====================================================================
-- Read-only views exposing two schema invariants so CI can assert them.
-- Author: Audit (Phase 11)   Date: 2026-08-09
--
-- WHY: DB-003 (revoke unreachable DML grants) and PERF-007 (drop redundant
-- indexes) were each verified once, by hand. That is worth nothing the day
-- someone adds a table — which arrives with Supabase's default
-- `grant all ... to anon, authenticated` — or copies an index alongside a
-- constraint that already provides it.
--
-- A test cannot check either property through PostgREST, because pg_indexes and
-- information_schema are not exposed. These two views are the smallest thing
-- that makes the invariants assertable from a test rather than from a human
-- remembering to look.
--
-- SECURITY: both are catalogue metadata only — table names and index names, no
-- row data. `security_invoker = true` so they cannot be used to read anything
-- the caller could not already read, and SELECT is granted to service_role
-- ONLY, which is what the CI suite authenticates as. anon and authenticated get
-- nothing.
-- =====================================================================

-- 1. Tables granting INSERT/UPDATE/DELETE to a client role where NO permissive
--    policy lets that role write. Every row here is a grant no query can use.
create or replace view public.v_client_dml_grants_without_policy
with (security_invoker = true) as
with dml as (
  select distinct table_name
  from information_schema.role_table_grants
  where table_schema = 'public'
    and grantee in ('anon', 'authenticated')
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
),
writable as (
  select distinct tablename as table_name
  from pg_policies
  where schemaname = 'public'
    and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    and (roles && array['anon', 'authenticated', 'public']::name[])
)
select d.table_name
from dml d
left join writable w using (table_name)
where w.table_name is null;

comment on view public.v_client_dml_grants_without_policy is
  'DB-003 invariant: must return zero rows. A row is an INSERT/UPDATE/DELETE grant to anon/authenticated that no RLS policy can exercise.';

-- 2. Index names in the public schema, so a test can assert that specific
--    redundant indexes stay dropped.
create or replace view public.v_public_indexes
with (security_invoker = true) as
select schemaname, tablename, indexname
from pg_indexes
where schemaname = 'public';

comment on view public.v_public_indexes is
  'PERF-007 support: index names only, no data. Lets CI assert that redundant indexes were not recreated.';

revoke all on public.v_client_dml_grants_without_policy from anon, authenticated;
revoke all on public.v_public_indexes from anon, authenticated;
grant select on public.v_client_dml_grants_without_policy to service_role;
grant select on public.v_public_indexes to service_role;

-- =====================================================================
-- ROLLBACK:
--   drop view if exists public.v_client_dml_grants_without_policy;
--   drop view if exists public.v_public_indexes;
-- =====================================================================
