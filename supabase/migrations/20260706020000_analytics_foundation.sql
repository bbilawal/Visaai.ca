-- Analytics SP-A foundation: append-only partitioned event store + reference
-- rollups + admin RLS helper. Service-role writes only (ingest processor);
-- admin reads. Conventions mirror 20260623020000_ai_usage_ledger.sql.

-- Admin predicate: mirror is_pricing_admin() — read from the same admin source.
create or replace function public.is_analytics_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
    false
  );
$$;

-- Append-only, monthly RANGE-partitioned event store.
-- Named analytics_event_stream (not analytics_events) to avoid colliding with
-- the pre-existing public.analytics_events table (20260604000000_analytics.sql).
create table public.analytics_event_stream (
  event_id        uuid        not null,
  name            text        not null,
  occurred_at     timestamptz not null,
  received_at     timestamptz not null default now(),
  source          text        not null check (source in ('server', 'client')),
  user_id         uuid        null,
  anonymous_id    text        null,
  session_id      text        null,
  application_id  uuid        null,
  schema_version  integer     not null default 1,
  props           jsonb       not null default '{}'::jsonb,
  primary key (event_id, occurred_at)
) partition by range (occurred_at);

create index analytics_event_stream_name_time_idx
  on public.analytics_event_stream (name, occurred_at desc);
create index analytics_event_stream_user_time_idx
  on public.analytics_event_stream (user_id, occurred_at desc);
create index analytics_event_stream_app_time_idx
  on public.analytics_event_stream (application_id, occurred_at desc);

alter table public.analytics_event_stream enable row level security;
-- No INSERT policy: writes are service-role only (RLS-bypassing admin client).
create policy analytics_event_stream_admin_read on public.analytics_event_stream
  for select using (public.is_analytics_admin());

-- Idempotent month-partition creator (called create-ahead by the rollup job).
-- SECURITY DEFINER: the runtime caller is the rollup job via the service-role
-- client (RPC), which does not own the parent table; `create table ... partition
-- of` requires parent ownership, so run as the function owner. Race-safe via
-- `create table if not exists` rather than a check-then-act pg_class guard.
create or replace function public.ensure_month_partition(p_month date)
returns void
language plpgsql
security definer
set search_path = public
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
end;
$$;
-- SECURITY DEFINER DDL helper: not callable via PostgREST RPC by clients.
revoke all on function public.ensure_month_partition(date) from public, anon, authenticated;

-- Create partitions for the current and next month so inserts have a home.
select public.ensure_month_partition(date_trunc('month', now())::date);
select public.ensure_month_partition((date_trunc('month', now()) + interval '1 month')::date);

-- Reference rollups (populated by analytics-rollup job).
create table public.analytics_event_daily (
  day   date   not null,
  name  text   not null,
  count bigint not null default 0,
  primary key (day, name)
);
create table public.analytics_daily_active (
  day date   primary key,
  dau bigint not null default 0,
  wau bigint not null default 0,
  mau bigint not null default 0
);
alter table public.analytics_event_daily  enable row level security;
alter table public.analytics_daily_active enable row level security;
create policy analytics_event_daily_admin_read on public.analytics_event_daily
  for select using (public.is_analytics_admin());
create policy analytics_daily_active_admin_read on public.analytics_daily_active
  for select using (public.is_analytics_admin());
