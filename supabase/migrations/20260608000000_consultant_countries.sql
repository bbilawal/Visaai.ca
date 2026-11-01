-- =====================================================================
-- Consultant ↔ country mapping (country-scoped consultant visibility).
-- Author: Database Architect   Date: 2026-06-08
-- Depends on: public.users
--
-- A consultant may be mapped to one or more destination countries (ISO-2,
-- matching applications.destination_country). Consultant application
-- visibility is derived EXCLUSIVELY from this table (active rows only).
-- Managed via SQL/seed for the MVP (no admin UI in this phase).
-- =====================================================================

create table if not exists public.consultant_countries (
  id            uuid primary key default uuid_generate_v4(),
  consultant_id uuid not null references public.users on delete cascade,
  country_code  text not null,                       -- ISO-2, e.g. 'CA','US','GB','AU'
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (consultant_id, country_code)
);

-- Queue lookup: "which active consultants cover country X" and
-- "which countries does consultant Y cover".
create index if not exists consultant_countries_country_active_idx
  on public.consultant_countries (country_code, active);
create index if not exists consultant_countries_consultant_active_idx
  on public.consultant_countries (consultant_id, active);

alter table public.consultant_countries enable row level security;

-- A consultant may read their OWN country mappings; admin reads all.
-- Writes go through the service-role / admin path (no self-write policy).
drop policy if exists consultant_countries_self_or_admin_read on public.consultant_countries;
create policy consultant_countries_self_or_admin_read on public.consultant_countries
  for select using (
    auth.uid() = consultant_id
    or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

drop policy if exists consultant_countries_admin_write on public.consultant_countries;
create policy consultant_countries_admin_write on public.consultant_countries
  for all using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  ) with check (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

comment on table public.consultant_countries is
  'Country-scoped consultant visibility (ISO-2). Active rows only. Single source for consultant queue country filtering. Service-role/admin write.';

-- =====================================================================
-- SEED (example — fill in real consultant UUIDs; safe to re-run).
-- Consultant A → CA, US ; Consultant B → AU ; Consultant C → GB
-- Replace the placeholder UUIDs with rows from public.users.
-- ---------------------------------------------------------------------
-- insert into public.consultant_countries (consultant_id, country_code) values
--   ('00000000-0000-0000-0000-00000000000A', 'CA'),
--   ('00000000-0000-0000-0000-00000000000A', 'US'),
--   ('00000000-0000-0000-0000-00000000000B', 'AU'),
--   ('00000000-0000-0000-0000-00000000000C', 'GB')
-- on conflict (consultant_id, country_code) do update set active = true;
-- =====================================================================

-- ROLLBACK:
--   drop table if exists public.consultant_countries;
