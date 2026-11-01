-- Find RLS policies that can recurse.
--
-- WHY
--
-- Every owner UPDATE on `applications` failed in production with
--
--   ERROR: infinite recursion detected in policy for relation "applications"
--
-- because its UPDATE policy inlined `EXISTS (SELECT 1 FROM
-- consultant_assignments ...)`, and that table's own policy reads back from
-- `applications`. Postgres detects the loop and refuses the statement. The
-- symptom was a 500 on an unrelated-looking feature (choosing a visa route),
-- and the fault was invisible until someone reproduced the write under RLS.
--
-- The cure, everywhere it appears, is a SECURITY DEFINER helper: the inner read
-- then runs without RLS and the cycle never forms. `is_active_assignee()`,
-- `app_has_active_consultant()` and `consultant_covers_country()` all exist for
-- this reason. A policy that reads another table INLINE is the thing to look
-- for.
--
-- WHAT THIS REPORTS
--
-- Pairs of tables whose policies read each other directly. That is a two-table
-- cycle, which is the shape that actually occurred. It does not chase longer
-- cycles (a → b → c → a) — extend the recursive term below if one ever appears.
-- Reads through a SECURITY DEFINER function are correctly NOT counted, because
-- they cannot recurse.
--
-- USAGE (on the VPS)
--
--   docker exec -i selfhosted_db psql -U postgres -f - < check-rls-policy-cycles.sql
--
-- Expected output: zero rows. Any row is a statement that will fail at runtime
-- for somebody.

with policy_refs as (
  select
    p.tablename as from_table,
    p.policyname,
    p.cmd,
    lower(m[1]) as to_table
  from pg_policies p
  cross join lateral regexp_matches(
    coalesce(p.qual, '') || ' ' || coalesce(p.with_check, ''),
    '\m(?:FROM|JOIN)\s+([a-zA-Z_][a-zA-Z0-9_]*)',
    'gi'
  ) as m
  where p.schemaname = 'public'
),
-- Only references to tables that themselves carry policies can close a loop.
edges as (
  select distinct r.from_table, r.to_table, r.policyname, r.cmd
  from policy_refs r
  where r.to_table <> r.from_table
    and exists (
      select 1 from pg_policies q
      where q.schemaname = 'public' and q.tablename = r.to_table
    )
)
select
  e.from_table,
  e.policyname as from_policy,
  e.cmd        as from_cmd,
  e.to_table,
  back.policyname as back_policy,
  back.cmd        as back_cmd
from edges e
join edges back
  on back.from_table = e.to_table
 and back.to_table   = e.from_table
order by e.from_table, e.policyname;
