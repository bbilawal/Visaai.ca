-- 20260709020000_analytics_reports.sql — SP-C saved/scheduled reports. Admin RLS.

create table if not exists public.analytics_saved_report (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  metric_key text not null,
  metric text not null,
  query jsonb not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.analytics_scheduled_report (
  id uuid primary key default gen_random_uuid(),
  saved_report_id uuid not null references public.analytics_saved_report(id) on delete cascade,
  cron text not null,
  format text not null,
  recipients text[] not null,
  notify_user_ids uuid[] not null default '{}',
  enabled boolean not null default true,
  last_run_at timestamptz,
  next_run_at timestamptz
);
create index if not exists analytics_scheduled_report_due_idx on public.analytics_scheduled_report (enabled, next_run_at);

create table if not exists public.analytics_report_run (
  id uuid primary key default gen_random_uuid(),
  saved_report_id uuid not null references public.analytics_saved_report(id) on delete cascade,
  scheduled_report_id uuid,
  status text not null,
  result_snapshot jsonb,
  error text,
  delivery_error text,
  ran_at timestamptz not null default now()
);

alter table public.analytics_saved_report enable row level security;
alter table public.analytics_scheduled_report enable row level security;
alter table public.analytics_report_run enable row level security;
-- Admin-only via service-role (admin client bypasses RLS); no anon/auth policies.
