-- Analytics + marketing instrumentation (Strategy Action 8 + 19).
--
-- Design rules:
--  * PII-MINIMIZED. `properties` and attribution columns must NEVER contain
--    document contents, passport/financial data, free-text answers, or email
--    bodies. Store IDs, enums, counts, stage names, and campaign tags only.
--    The application layer is responsible for not writing PII here.
--  * RLS-protected. Users can read only their own rows. Inserts come from the
--    authenticated user (own rows) or the API service role (system events).
--  * North-star metric = an application reaching a Readiness (VRI) score.

-- ── Event log ────────────────────────────────────────────────────────────────
create table if not exists public.analytics_events (
  id uuid primary key default uuid_generate_v4(),
  -- user_id null while a visitor is pre-signup; correlate later via anon_id.
  user_id uuid references public.users on delete set null,
  anon_id text,                         -- first-party cookie id, pre-auth
  application_id uuid references public.applications on delete set null,
  event_name text not null,             -- e.g. 'application_readiness_reached'
  stage text,                           -- intake|documents|narrative|readiness|submission|tracking
  properties jsonb not null default '{}'::jsonb,  -- PII-FREE metadata only
  occurred_at timestamptz not null default now()
);

create index if not exists analytics_events_user_time_idx
  on public.analytics_events (user_id, occurred_at desc);
create index if not exists analytics_events_name_time_idx
  on public.analytics_events (event_name, occurred_at desc);
create index if not exists analytics_events_app_idx
  on public.analytics_events (application_id);
create index if not exists analytics_events_anon_idx
  on public.analytics_events (anon_id) where anon_id is not null;

alter table public.analytics_events enable row level security;

create policy "analytics_events_select_own" on public.analytics_events
  for select using (auth.uid() = user_id);
create policy "analytics_events_insert_own" on public.analytics_events
  for insert with check (user_id is null or auth.uid() = user_id);

comment on table public.analytics_events is
  'PII-FREE product + funnel events. Never store document/identity/financial data or free text here.';

-- ── Marketing attribution (one row per user, first + last touch) ─────────────
create table if not exists public.marketing_attribution (
  user_id uuid primary key references public.users on delete cascade,
  anon_id text,
  first_touch_at timestamptz not null default now(),
  last_touch_at timestamptz not null default now(),
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  referrer_host text,                   -- host only, not full URL with query/PII
  landing_path text                     -- path only, strip query string in app layer
);

alter table public.marketing_attribution enable row level security;

create policy "marketing_attribution_select_own" on public.marketing_attribution
  for select using (auth.uid() = user_id);
create policy "marketing_attribution_upsert_own" on public.marketing_attribution
  for insert with check (auth.uid() = user_id);
create policy "marketing_attribution_update_own" on public.marketing_attribution
  for update using (auth.uid() = user_id);

comment on table public.marketing_attribution is
  'Campaign attribution per user. Store host/path/utm tags only, never full URLs or PII.';

-- ── North-star funnel view ───────────────────────────────────────────────────
-- Furthest stage reached per application, for funnel + north-star (readiness).
-- security_invoker so the querying user only sees their own applications via RLS.
create or replace view public.v_application_funnel
with (security_invoker = on) as
select
  a.id            as application_id,
  a.user_id,
  a.status,
  a.created_at,
  exists (
    select 1 from public.vri_scores v where v.application_id = a.id
  )               as reached_readiness,   -- north-star flag
  (
    select max(e.occurred_at)
    from public.analytics_events e
    where e.application_id = a.id
      and e.event_name = 'application_readiness_reached'
  )               as readiness_reached_at
from public.applications a;

comment on view public.v_application_funnel is
  'North-star funnel: reached_readiness marks an application that earned a VRI score.';

-- ── Outcome reporting (the data moat) ────────────────────────────────────────
-- User-reported real decisions. Over time this is what turns the heuristic VRI
-- score into an outcome-calibrated model. Self-reported, optional, never shared.
create table if not exists public.application_outcomes (
  id uuid primary key default uuid_generate_v4(),
  application_id uuid not null references public.applications on delete cascade,
  user_id uuid not null references public.users on delete cascade,
  outcome text not null check (outcome in ('approved','refused','withdrawn','pending')),
  decided_at date,                      -- date only; no need for finer PII granularity
  refusal_reasons text[],               -- optional, user-selected from a fixed list (not free text)
  reported_at timestamptz not null default now(),
  unique (application_id)
);

create index if not exists application_outcomes_outcome_idx
  on public.application_outcomes (outcome);

alter table public.application_outcomes enable row level security;

create policy "application_outcomes_select_own" on public.application_outcomes
  for select using (auth.uid() = user_id);
create policy "application_outcomes_insert_own" on public.application_outcomes
  for insert with check (auth.uid() = user_id);
create policy "application_outcomes_update_own" on public.application_outcomes
  for update using (auth.uid() = user_id);

comment on table public.application_outcomes is
  'Self-reported visa decisions. refusal_reasons must come from a fixed list, not free text (no PII).';
