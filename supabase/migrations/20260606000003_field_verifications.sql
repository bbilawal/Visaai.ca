-- =====================================================================
-- Gate 2 — Phase 2A.4  field_verifications  (per-field verification state)
-- Author: Database Architect   Date: 2026-06-06
-- Depends on: applications, users, documents, verification_state enum
-- state is a CACHE of the latest transition; the audit log is authoritative.
-- =====================================================================

create table if not exists public.field_verifications (
  id              uuid primary key default uuid_generate_v4(),
  application_id  uuid not null references public.applications on delete cascade,

  field_key       text not null,
  section         text,                          -- rollup group ("Personal","Passport"...)

  state           verification_state not null default 'EXTRACTED',

  -- value binding for drift detection (EC-1)
  value_snapshot      text,
  value_hash          text,
  source              text check (source is null or source in ('profile','document','inferred')),
  source_document_id  uuid references public.documents on delete set null,

  -- actor + audit timestamps (who advanced it last)
  user_confirmed_by        uuid references public.users on delete set null,
  user_confirmed_at        timestamptz,
  consultant_reviewed_by   uuid references public.users on delete set null,
  consultant_reviewed_at   timestamptz,
  consultant_approved_by   uuid references public.users on delete set null,
  consultant_approved_at   timestamptz,
  executed_at              timestamptz,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (application_id, field_key)
);

create index if not exists field_verifications_app_idx
  on public.field_verifications (application_id);
create index if not exists field_verifications_app_section_idx
  on public.field_verifications (application_id, section);
create index if not exists field_verifications_app_state_idx
  on public.field_verifications (application_id, state);

-- keep updated_at honest
create or replace function public.touch_field_verifications()
returns trigger as $$
begin new.updated_at := now(); return new; end;
$$ language plpgsql;

drop trigger if exists field_verifications_touch on public.field_verifications;
create trigger field_verifications_touch
  before update on public.field_verifications
  for each row execute function public.touch_field_verifications();

-- Derived section rollup: weakest field in a section drives the section state.
create or replace view public.section_verification as
select application_id,
       section,
       min(state) as section_state,
       count(*)                                              as field_count,
       count(*) filter (where state >= 'EXECUTION_READY')    as ready_count
from public.field_verifications
group by application_id, section;

alter table public.field_verifications enable row level security;

-- Owner may READ. Applicant-role confirm transitions and consultant/system
-- transitions go through guarded service paths (service role) -> no broad
-- client write policy here (keeps EXECUTION_READY/EXECUTED out of client reach).
drop policy if exists field_verifications_owner_read on public.field_verifications;
create policy field_verifications_owner_read on public.field_verifications
  for select using (
    auth.uid() = (select user_id from public.applications where id = application_id)
  );

comment on table public.field_verifications is
  'Gate 2: per-field verification state cache. Canonical history lives in audit_events. Service-role write.';

-- =====================================================================
-- ROLLBACK:
--   drop view if exists public.section_verification;
--   drop trigger if exists field_verifications_touch on public.field_verifications;
--   drop function if exists public.touch_field_verifications();
--   drop table if exists public.field_verifications;
-- =====================================================================
