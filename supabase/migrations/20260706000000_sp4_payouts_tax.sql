-- SP4 — consultant tax profile (encrypted tax id) + annual earnings statements.
-- Owner-scoped via consultant_profiles.user_id; service-role writes.

create table if not exists public.consultant_tax_profiles (
  id uuid primary key default uuid_generate_v4(),
  consultant_id uuid not null unique references public.consultant_profiles(id) on delete cascade,
  tax_country text not null,
  form_type text not null check (form_type in ('w9','w8')),
  tax_id_encrypted text,
  business_name text,
  status text not null default 'pending' check (status in ('pending','submitted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.consultant_tax_profiles enable row level security;
create policy consultant_tax_profiles_owner_read on public.consultant_tax_profiles
  for select using (
    consultant_id in (select id from public.consultant_profiles where user_id = auth.uid())
  );

create table if not exists public.payout_tax_statements (
  id uuid primary key default uuid_generate_v4(),
  consultant_id uuid not null references public.consultant_profiles(id) on delete cascade,
  tax_year integer not null,
  currency text not null default 'usd',
  gross_paid_cents bigint not null default 0 check (gross_paid_cents >= 0),
  payout_count integer not null default 0 check (payout_count >= 0),
  generated_at timestamptz not null default now(),
  unique (consultant_id, tax_year)
);
alter table public.payout_tax_statements enable row level security;
create policy payout_tax_statements_owner_read on public.payout_tax_statements
  for select using (
    consultant_id in (select id from public.consultant_profiles where user_id = auth.uid())
  );
create policy payout_tax_statements_admin_read on public.payout_tax_statements
  for select using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- ROLLBACK:
--   drop table if exists public.payout_tax_statements;
--   drop table if exists public.consultant_tax_profiles;
