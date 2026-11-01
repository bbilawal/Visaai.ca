-- =====================================================================
-- SP1 — Payment Foundation
--   1. payments: presentment currency + provider columns
--   2. payment_events: append-only payment ledger (immutable)
--   3. reconciliation_runs / reconciliation_exceptions
-- Reuses public.audit_no_mutate() (audit spine) for append-only enforcement.
-- Admin reads gated by JWT app_metadata role (same pattern as messaging_spine).
-- Service-role writes bypass RLS (no insert policy needed).
-- =====================================================================

-- ---- 1. payments: multi-currency + provider ----------------------------
alter table public.payments
  add column if not exists currency text not null default 'usd',
  add column if not exists provider text not null default 'stripe';
comment on column public.payments.amount_cents is
  'Amount in the currency''s minor unit (see payments.currency).';

-- ---- 2. append-only payment ledger -------------------------------------
create table if not exists public.payment_events (
  id                 uuid primary key default uuid_generate_v4(),
  provider           text not null,
  event_type         text not null,
  provider_event_id  text not null unique,
  provider_object_id text not null,
  amount_minor       bigint,
  currency           text,
  direction          text not null check (direction in ('credit', 'debit')),
  user_id            uuid references auth.users(id),
  related_entity     jsonb not null default '{}'::jsonb,
  occurred_at        timestamptz not null,
  recorded_at        timestamptz not null default now()
);
create index if not exists payment_events_object_idx
  on public.payment_events (provider_object_id);
create index if not exists payment_events_occurred_idx
  on public.payment_events (occurred_at);

-- Immutability: reuse the audit spine's guard (raises on UPDATE/DELETE).
drop trigger if exists payment_events_no_update on public.payment_events;
create trigger payment_events_no_update
  before update on public.payment_events
  for each row execute function public.audit_no_mutate();

drop trigger if exists payment_events_no_delete on public.payment_events;
create trigger payment_events_no_delete
  before delete on public.payment_events
  for each row execute function public.audit_no_mutate();

-- ---- 3. reconciliation run + exceptions --------------------------------
create table if not exists public.reconciliation_runs (
  id              uuid primary key default uuid_generate_v4(),
  run_date        date not null,
  range_start     timestamptz not null,
  range_end       timestamptz not null,
  provider        text not null,
  matched_count   integer not null default 0,
  exception_count integer not null default 0,
  status          text not null default 'running',
  started_at      timestamptz not null default now(),
  finished_at     timestamptz
);

create table if not exists public.reconciliation_exceptions (
  id                 uuid primary key default uuid_generate_v4(),
  run_id             uuid not null references public.reconciliation_runs(id) on delete cascade,
  kind               text not null check (kind in ('missing_in_ledger', 'phantom_in_ledger', 'amount_mismatch')),
  provider_object_id text not null,
  expected           jsonb,
  actual             jsonb,
  resolved           boolean not null default false,
  created_at         timestamptz not null default now()
);
create index if not exists reconciliation_exceptions_run_idx
  on public.reconciliation_exceptions (run_id);

-- Exceptions are append-only evidence (a resolved flag lives on a future
-- workflow table, not by mutating the exception itself).
drop trigger if exists reconciliation_exceptions_no_update on public.reconciliation_exceptions;
create trigger reconciliation_exceptions_no_update
  before update on public.reconciliation_exceptions
  for each row execute function public.audit_no_mutate();

-- ---- 4. RLS: admins read; service role writes (bypasses RLS) -----------
alter table public.payment_events            enable row level security;
alter table public.reconciliation_runs       enable row level security;
alter table public.reconciliation_exceptions enable row level security;

drop policy if exists payment_events_admin_read on public.payment_events;
create policy payment_events_admin_read on public.payment_events
  for select using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists reconciliation_runs_admin_read on public.reconciliation_runs;
create policy reconciliation_runs_admin_read on public.reconciliation_runs
  for select using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists reconciliation_exceptions_admin_read on public.reconciliation_exceptions;
create policy reconciliation_exceptions_admin_read on public.reconciliation_exceptions
  for select using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

comment on table public.payment_events is
  'SP1: append-only payment ledger. UPDATE/DELETE blocked. Event-level idempotency via provider_event_id UNIQUE.';

-- =====================================================================
-- ROLLBACK:
--   drop table if exists public.reconciliation_exceptions;
--   drop table if exists public.reconciliation_runs;
--   drop trigger if exists payment_events_no_update on public.payment_events;
--   drop trigger if exists payment_events_no_delete on public.payment_events;
--   drop table if exists public.payment_events;
--   alter table public.payments drop column if exists currency;
--   alter table public.payments drop column if exists provider;
-- =====================================================================
