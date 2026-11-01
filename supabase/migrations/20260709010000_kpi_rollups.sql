-- 20260709010000_kpi_rollups.sql
-- SP-B KPI rollup tables. Admin-read RLS (matches SP-A analytics rollups).

create table if not exists public.kpi_metric_daily (
  day date not null,
  metric text not null,
  dim_key text not null default '',
  dim_val text not null default '',
  value_num numeric not null,
  primary key (day, metric, dim_key, dim_val)
);

create table if not exists public.kpi_funnel_daily (
  day date not null,
  funnel text not null,
  step text not null,
  step_index int not null,
  dim_key text not null default '',
  dim_val text not null default '',
  entered bigint not null default 0,
  converted bigint not null default 0,
  primary key (day, funnel, step, dim_key, dim_val)
);

create table if not exists public.kpi_retention_cohort (
  cohort_month date not null,
  period_index int not null,
  dim_key text not null default '',
  dim_val text not null default '',
  cohort_size bigint not null default 0,
  retained bigint not null default 0,
  retained_cents bigint not null default 0,
  primary key (cohort_month, period_index, dim_key, dim_val)
);

create table if not exists public.analytics_identity_map (
  anonymous_id text primary key,
  user_id uuid not null,
  linked_at timestamptz not null default now()
);
create index if not exists analytics_identity_map_user_idx on public.analytics_identity_map (user_id);

alter table public.kpi_metric_daily enable row level security;
alter table public.kpi_funnel_daily enable row level security;
alter table public.kpi_retention_cohort enable row level security;
alter table public.analytics_identity_map enable row level security;

-- Service-role (admin client) bypasses RLS; no anon/auth policies => admin-read only,
-- matching analytics_event_daily / analytics_daily_active from SP-A.
