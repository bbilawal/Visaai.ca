-- PRICE-7/10 — AI token cost ledger.
-- Append-only ai_usage_events → ai_cost_per_application rollup, supplying
-- ai_cost_actual to the engine (07 §6.3) and the profit dashboard (08 §6 panel 4).
-- Conventions mirror 20260616000000_pricing_engine.sql (uuid PK, RLS, service-role writes).

create table public.ai_usage_events (
  id              uuid primary key default uuid_generate_v4(),
  application_id  uuid references public.applications(id) on delete set null,
  user_id         uuid references auth.users(id) on delete set null,
  provider        text not null
                    check (provider in ('openai', 'anthropic', 'gemini', 'ocr', 'search')),
  model           text not null,
  operation       text not null,
  input_tokens    integer not null default 0 check (input_tokens  >= 0),
  output_tokens   integer not null default 0 check (output_tokens >= 0),
  units           integer not null default 0 check (units >= 0),
  request_cost_usd  numeric(12, 6) not null check (request_cost_usd >= 0),
  billable_cost_usd numeric(12, 6) check (billable_cost_usd >= 0),
  price_snapshot_id uuid,
  created_at      timestamptz not null default now()
);
create index ai_usage_events_app_idx     on public.ai_usage_events (application_id, created_at desc);
create index ai_usage_events_user_idx    on public.ai_usage_events (user_id, created_at desc);
create index ai_usage_events_created_idx on public.ai_usage_events (created_at desc);

-- RLS: user reads own; admin reads all; writes are service-role only (no anon/user write).
alter table public.ai_usage_events enable row level security;
create policy ai_usage_events_owner_read on public.ai_usage_events
  for select using (auth.uid() = user_id);
create policy ai_usage_events_admin_read on public.ai_usage_events
  for select using (public.is_pricing_admin());

-- Per-application rollup → the single ai_cost_actual the engine + dashboard read.
create materialized view public.ai_cost_per_application as
select
  e.application_id,
  count(*)                  as call_count,
  sum(e.input_tokens)       as input_tokens,
  sum(e.output_tokens)      as output_tokens,
  sum(e.units)              as units,
  sum(e.request_cost_usd)   as ai_cost_actual,
  sum(e.billable_cost_usd)  as billable_cost_actual,
  max(e.created_at)         as last_event_at
from public.ai_usage_events e
where e.application_id is not null
group by e.application_id;
create unique index ai_cost_per_application_pk
  on public.ai_cost_per_application (application_id);   -- enables REFRESH … CONCURRENTLY

-- Dashboard view (08 §6 panel 4): metered cost vs the 04 estimate per application.
-- Corridor resolves via framework_id → country_frameworks (verified: applications has
-- no visa_type/country_code columns; both live on country_frameworks).
create view public.ai_cost_actual_vs_model as
select
  a.id                                       as application_id,
  cf.visa_type,
  cf.country_code,
  c.ai_cost_actual,
  (q.breakdown ->> 'ai_cost')::numeric        as ai_cost_model,
  c.ai_cost_actual - (q.breakdown ->> 'ai_cost')::numeric as drift_usd
from public.applications a
left join public.country_frameworks cf       on cf.id = a.framework_id
left join public.ai_cost_per_application c   on c.application_id = a.id
left join public.pricing_quotes q
       on q.visa_type = cf.visa_type and q.country_code = cf.country_code;

-- Cost rollups are admin/system-only; never exposed through the anon/user PostgREST API.
revoke all on public.ai_cost_per_application from anon, authenticated;
revoke all on public.ai_cost_actual_vs_model from anon, authenticated;
