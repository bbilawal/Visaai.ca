-- Task 14 security audit — database hardening.
--
-- Two defence-in-depth gaps found by linting the schema rebuilt from migrations
-- into a throwaway Postgres. Neither is exploitable through an interface we
-- expose today; both are cheap to close and expensive to discover later.
--
-- 1. RLS on analytics_event_stream partitions
--
--    `analytics_event_stream` is RANGE-partitioned and RLS-enabled, with a
--    single admin-read policy. Its PARTITIONS inherit the policy only when the
--    row is reached through the parent. A query issued directly against
--    `analytics_event_stream_202608` is not filtered by the parent's policy.
--
--    That is not reachable through PostgREST — partitions are absent from its
--    schema cache and return PGRST205 — so this is not a live data-exposure
--    path. It is one connection-string away from being one, and the analytics
--    stream carries user_id and application_id.
--
--    `ensure_month_partition` is also fixed so every FUTURE partition is
--    created with RLS on, rather than this being a one-time cleanup that the
--    next month silently undoes.
--
-- 2. Mutable search_path on SECURITY DEFINER functions
--
--    A SECURITY DEFINER function without a pinned `search_path` resolves
--    unqualified names using the CALLER's search_path, so an attacker who can
--    create an object in an earlier schema can have the function call theirs
--    with the definer's privileges.
--
--    Today `anon` and `authenticated` hold no CREATE on `public`
--    (has_schema_privilege = false both), so the escalation has no starting
--    point. That is a property of the current grants, not of these functions —
--    and one of them, handle_new_user, runs on every single signup while two
--    others move money. They should not depend on a grant elsewhere staying
--    correct.

-- ── 1. Partition RLS ────────────────────────────────────────────────────────

do $$
declare
  part record;
begin
  for part in
    select c.relname
    from pg_class c
    join pg_inherits i on i.inhrelid = c.oid
    join pg_class parent on parent.oid = i.inhparent
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and parent.relname = 'analytics_event_stream'
      and c.relrowsecurity = false
  loop
    execute format(
      'alter table public.%I enable row level security', part.relname
    );
  end loop;
end;
$$;

-- Every future partition gets RLS at creation time.
create or replace function public.ensure_month_partition(p_month date)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  start_ts date := date_trunc('month', p_month)::date;
  end_ts   date := (date_trunc('month', p_month) + interval '1 month')::date;
  part     text := 'analytics_event_stream_' || to_char(start_ts, 'YYYYMM');
begin
  execute format(
    'create table if not exists public.%I partition of public.analytics_event_stream
       for values from (%L) to (%L)',
    part, start_ts, end_ts
  );
  -- A partition does not inherit the parent's row-security setting. Without
  -- this, direct access to the partition is unfiltered.
  execute format('alter table public.%I enable row level security', part);
end;
$$;
revoke all on function public.ensure_month_partition(date) from public, anon, authenticated;

-- ── 2. Pin search_path on public functions ──────────────────────────────────
--
-- Two details that are easy to get wrong, and one that WAS got wrong here:
--
--   * `pg_temp` is named LAST explicitly. If it is not named at all, Postgres
--     searches it FIRST, which reintroduces the same hijack via a temp object.
--
--   * `extensions` MUST be included. Supabase installs pgcrypto, uuid-ossp,
--     pg_net and pg_stat_statements into the `extensions` schema, not `public`.
--     An earlier revision of this migration pinned to `public, pg_temp` only —
--     which silently broke `field_provenance_create_version`, whose body calls
--     `uuid_generate_v4()`. That function exists ONLY in `extensions`, so the
--     pin made it unresolvable. Confirmed against production:
--
--       set search_path = public, pg_temp;
--         select to_regprocedure('uuid_generate_v4()') is null;  -- t  (broken)
--       set search_path = public, extensions, pg_temp;
--         select to_regprocedure('uuid_generate_v4()') is null;  -- f  (works)
--
--     A search_path pin is a name-resolution change, not just a security flag.
--     Anything the function body calls has to still be on the path.
--
--   * Applied to ALL functions, not only SECURITY DEFINER ones. Several
--     invoker functions (`is_marketplace_admin`, `is_pricing_admin`,
--     `is_risk_admin`) are called from inside RLS POLICIES, where influencing
--     name resolution influences an authorization decision.

do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      -- Never touch extension-owned functions. btree_gist alone contributes
      -- ~188 of them, and they are owned by the extension, not by us:
      -- `alter function` on one fails with "must be owner of function
      -- gbtreekey4_in". This migration originally succeeded against production
      -- only because btree_gist had already been relocated out of `public` by
      -- the time it was re-applied — a clean rebuild, where 20260806110000 has
      -- not run yet, failed. Filtering on pg_depend makes it order-independent.
      and not exists (
        select 1 from pg_depend d
        where d.objid = p.oid and d.deptype = 'e'
      )
      and (
        p.proconfig is null
        or not exists (
          select 1 from unnest(p.proconfig) c where c like 'search_path=%'
        )
      )
  loop
    execute format(
      'alter function %s set search_path = public, extensions, pg_temp', fn.sig
    );
  end loop;

  -- Repair anything an earlier revision pinned without `extensions`.
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and not exists (
        select 1 from pg_depend d
        where d.objid = p.oid and d.deptype = 'e'
      )
      and exists (
        select 1 from unnest(p.proconfig) c
        where c like 'search_path=%' and c not like '%extensions%'
      )
  loop
    execute format(
      'alter function %s set search_path = public, extensions, pg_temp', fn.sig
    );
  end loop;
end;
$$;
