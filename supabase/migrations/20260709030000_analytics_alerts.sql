-- 20260709030000_analytics_alerts.sql — SP-E alert rules + fired events. Admin RLS.

create table if not exists public.analytics_alert_rule (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  metric_key text not null,
  metric text not null,
  query jsonb not null,
  conditions jsonb not null,
  combine text not null default 'all',
  recipients text[] not null default '{}',
  notify_user_ids uuid[] not null default '{}',
  enabled boolean not null default true,
  state text not null default 'ok',
  last_value numeric,
  last_evaluated_at timestamptz,
  last_transition_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists analytics_alert_rule_enabled_idx on public.analytics_alert_rule (enabled);

create table if not exists public.analytics_alert_event (
  id uuid primary key default gen_random_uuid(),
  rule_id uuid not null references public.analytics_alert_rule(id) on delete cascade,
  kind text not null,
  value numeric,
  message text not null,
  fired_at timestamptz not null default now()
);

alter table public.analytics_alert_rule enable row level security;
alter table public.analytics_alert_event enable row level security;
-- Admin-only via service-role (admin client bypasses RLS); no anon/auth policies.
