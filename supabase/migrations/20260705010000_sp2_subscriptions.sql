-- SP2 — subscriptions + metered capped review credits (Hybrid-C v2).
-- Owner-read RLS; service-role writes (webhook). Credits: single period row +
-- atomic consume fn = margin-inversion guard (06 §2). Flag-gated in app.

create table if not exists public.subscriptions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users on delete cascade,
  stripe_subscription_id text not null unique,
  stripe_customer_id text not null,
  plan text not null check (plan in ('base','pro','premium')),
  status text not null check (status in ('active','trialing','past_due','canceled','incomplete')),
  billing_interval text not null default 'month' check (billing_interval in ('month','year')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists subscriptions_user_status_idx on public.subscriptions (user_id, status);

create table if not exists public.subscription_credits (
  id uuid primary key default uuid_generate_v4(),
  subscription_id uuid not null references public.subscriptions on delete cascade,
  user_id uuid not null references public.users on delete cascade,
  period_start timestamptz not null,
  period_end timestamptz not null,
  granted integer not null default 0 check (granted >= 0),
  consumed integer not null default 0 check (consumed >= 0),
  stripe_usage_record_id text,
  created_at timestamptz not null default now(),
  check (consumed <= granted),
  unique (subscription_id, period_start)
);
create index if not exists subscription_credits_balance_idx
  on public.subscription_credits (subscription_id, period_start);

-- Atomic consume: increments only if the current period has a free credit.
-- SECURITY DEFINER so the app calls it via service-role RPC; the WHERE guard +
-- the table check make over-consumption impossible even under concurrency.
create or replace function public.consume_review_credit(p_user_id uuid, p_application_id uuid)
returns boolean as $$
declare v_id uuid;
begin
  update public.subscription_credits
     set consumed = consumed + 1
   where user_id = p_user_id
     and now() >= period_start and now() < period_end
     and consumed < granted
   returning id into v_id;
  return v_id is not null;
end;
$$ language plpgsql security definer;

alter table public.consultant_service_orders
  add column if not exists credit_covered boolean not null default false;

alter table public.subscriptions enable row level security;
alter table public.subscription_credits enable row level security;

drop policy if exists subscriptions_own_read on public.subscriptions;
create policy subscriptions_own_read on public.subscriptions
  for select using (auth.uid() = user_id);

drop policy if exists subscription_credits_own_read on public.subscription_credits;
create policy subscription_credits_own_read on public.subscription_credits
  for select using (auth.uid() = user_id);

comment on function public.consume_review_credit(uuid, uuid) is
  'SP2: atomic review-credit consumption; false => no credit (route to paid). Margin-inversion guard.';

-- ROLLBACK:
--   alter table public.consultant_service_orders drop column if exists credit_covered;
--   drop function if exists public.consume_review_credit(uuid, uuid);
--   drop table if exists public.subscription_credits;
--   drop table if exists public.subscriptions;
