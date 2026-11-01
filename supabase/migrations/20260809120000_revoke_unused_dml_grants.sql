-- =====================================================================
-- Revoke write grants that no RLS policy can ever exercise (DB-003).
-- Author: Audit (Phase 8 remediation)   Date: 2026-08-09
--
-- WHY: Supabase's bootstrap issues `grant all on all tables in schema public
-- to anon, authenticated`. RLS is what actually protects those tables, and it
-- does — 40 tenant-isolation tests prove it. But on a table with NO permissive
-- write policy for those roles, the INSERT/UPDATE/DELETE grant is pure surplus:
-- it can never be exercised, and it is one policy mistake away from mattering.
-- Measured locally: 137 tables carry the grant, 53 have a real write policy,
-- and 84 do not.
--
-- WHY DYNAMIC rather than a hardcoded list. A list derived from one database
-- can be wrong in another: if production has a write policy that local lacks,
-- a static REVOKE would break a working path. This computes the same predicate
-- at apply time in whichever database it runs against, so it can only ever
-- remove a grant that is unreachable THERE. The predicate is the audit trail.
--
-- SAFE: removes only unreachable privileges. No table, column, policy or row is
-- touched. Any statement a client can execute today, it can still execute after.
--
-- NOT REVERSIBLE BY GUESSWORK — the rollback at the bottom restores the
-- Supabase default for the same computed set.
--
-- NOT YET APPLIED TO PRODUCTION. Blocked on BLK-1: production has no backup,
-- and a privilege change without one is not a risk worth taking for a
-- defence-in-depth improvement. Applied and verified on the local stack.
-- =====================================================================

do $$
declare
  r record;
  n int := 0;
begin
  for r in
    with dml as (
      select distinct table_name
      from information_schema.role_table_grants
      where table_schema = 'public'
        and grantee in ('anon', 'authenticated')
        and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
    ),
    -- A table is "writable by a client role" if ANY permissive policy grants a
    -- write command to anon/authenticated/public. `ALL` counts: it covers writes.
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
    where w.table_name is null
    order by 1
  loop
    execute format(
      'revoke insert, update, delete on public.%I from anon, authenticated',
      r.table_name
    );
    n := n + 1;
  end loop;

  raise notice 'DB-003: revoked unreachable write grants on % table(s)', n;
end
$$;

-- =====================================================================
-- ROLLBACK (restores the Supabase default on the same computed set):
--   do $$
--   declare r record;
--   begin
--     for r in
--       select tablename from pg_tables where schemaname = 'public'
--     loop
--       execute format(
--         'grant insert, update, delete on public.%I to anon, authenticated',
--         r.tablename);
--     end loop;
--   end $$;
-- =====================================================================
