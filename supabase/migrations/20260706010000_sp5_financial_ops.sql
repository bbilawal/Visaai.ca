-- SP5 — financial ops: refunds, disputes, dunning.
-- Admin-read (jwt app_metadata role) + service-role write; dunning owner+admin read.

create table if not exists public.refunds (
  id uuid primary key default uuid_generate_v4(),
  payment_id uuid references public.payments(id) on delete set null,
  stripe_refund_id text,
  amount_cents integer not null check (amount_cents >= 0),
  reason text,
  status text not null default 'pending' check (status in ('pending','succeeded','failed')),
  initiated_by uuid,
  created_at timestamptz not null default now()
);
alter table public.refunds enable row level security;
create policy refunds_admin_read on public.refunds
  for select using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create table if not exists public.payment_disputes (
  id uuid primary key default uuid_generate_v4(),
  payment_id uuid references public.payments(id) on delete set null,
  stripe_dispute_id text not null unique,
  provider_object_id text not null,
  amount_cents integer,
  currency text,
  reason text,
  status text not null default 'open',
  created_at timestamptz not null default now()
);
alter table public.payment_disputes enable row level security;
create policy payment_disputes_admin_read on public.payment_disputes
  for select using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

create table if not exists public.payment_dunning (
  id uuid primary key default uuid_generate_v4(),
  subscription_id uuid not null unique references public.subscriptions(id) on delete cascade,
  attempts integer not null default 0 check (attempts >= 0),
  last_attempt_at timestamptz,
  status text not null default 'active' check (status in ('active','recovered','canceled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.payment_dunning enable row level security;
create policy payment_dunning_admin_read on public.payment_dunning
  for select using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

alter table public.payments add column if not exists disputed_at timestamptz;

-- ROLLBACK:
--   alter table public.payments drop column if exists disputed_at;
--   drop table if exists public.payment_dunning;
--   drop table if exists public.payment_disputes;
--   drop table if exists public.refunds;
