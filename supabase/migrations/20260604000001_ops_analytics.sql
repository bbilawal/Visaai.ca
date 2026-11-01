-- Agent-company operations analytics (Strategy Action 8, ops layer).
--
-- These tables are INTERNAL operational data, not user-owned. They track the
-- product portfolio, experiments, marketing, revenue, and agent runs.
--
-- Security model: RLS is ENABLED with NO client policies, so anon/authenticated
-- clients get zero access. Only the service-role key (server-side ops jobs)
-- can read/write them. PII-MINIMIZED: store IDs, enums, tags, counts, and
-- aggregates only. Never store end-user identity, document, or contact data here.

-- ── Product portfolio ────────────────────────────────────────────────────────
create table if not exists public.ops_products (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text unique not null,
  status text not null default 'idea'
    check (status in ('idea','research','building','launched','paused','killed')),
  market text,
  opportunity_score int check (opportunity_score between 0 and 100),
  legal_risk text check (legal_risk in ('low','medium','high','critical')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Experiments ──────────────────────────────────────────────────────────────
create table if not exists public.ops_experiments (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid references public.ops_products on delete cascade,
  hypothesis text not null,
  variant text,
  metric text,
  status text not null default 'planned'
    check (status in ('planned','running','complete','abandoned')),
  result text,
  ice_score numeric,
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

-- ── Marketing events ─────────────────────────────────────────────────────────
create table if not exists public.ops_marketing_events (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid references public.ops_products on delete cascade,
  channel text not null,                -- seo|paid_search|content|reddit|linkedin|youtube|product_hunt|referral|partnership
  campaign text,
  event_type text not null,             -- impression|click|signup|activation|spend
  metrics jsonb not null default '{}'::jsonb,  -- counts/costs only, no PII
  occurred_at timestamptz not null default now()
);

create index if not exists ops_marketing_events_product_time_idx
  on public.ops_marketing_events (product_id, occurred_at desc);
create index if not exists ops_marketing_events_channel_idx
  on public.ops_marketing_events (channel);

-- ── Revenue ──────────────────────────────────────────────────────────────────
create table if not exists public.ops_revenue (
  id uuid primary key default uuid_generate_v4(),
  product_id uuid references public.ops_products on delete cascade,
  source text not null,                 -- pay_per_app|subscription|consultant|enterprise
  amount_cents bigint not null default 0,
  currency text not null default 'CAD',
  mrr_cents bigint,
  stripe_ref text,                      -- opaque Stripe id, not card data
  occurred_at timestamptz not null default now()
);

create index if not exists ops_revenue_product_time_idx
  on public.ops_revenue (product_id, occurred_at desc);

-- ── Agent runs ───────────────────────────────────────────────────────────────
create table if not exists public.ops_agent_runs (
  id uuid primary key default uuid_generate_v4(),
  agent text not null,                  -- e.g. trend-researcher, backend-architect
  task text,
  product_id uuid references public.ops_products on delete set null,
  status text not null default 'running'
    check (status in ('running','completed','failed')),
  cost_usd numeric,
  tokens int,
  output_ref text,                      -- pointer (path/url), not the full output
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists ops_agent_runs_agent_time_idx
  on public.ops_agent_runs (agent, started_at desc);

-- ── Lock down: service-role only (RLS on, no client policies) ─────────────────
alter table public.ops_products enable row level security;
alter table public.ops_experiments enable row level security;
alter table public.ops_marketing_events enable row level security;
alter table public.ops_revenue enable row level security;
alter table public.ops_agent_runs enable row level security;

comment on table public.ops_products is
  'Internal ops. Service-role only (RLS on, no client policies). No end-user PII.';
comment on table public.ops_revenue is
  'Internal ops. stripe_ref is an opaque id; never store card/payment-instrument data.';
