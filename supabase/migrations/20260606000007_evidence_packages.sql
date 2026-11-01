-- =====================================================================
-- Gate 2 — Phase 2A.8  evidence_packages
-- Author: Database Architect   Date: 2026-06-06
-- Depends on: applications, submission_sessions, users
-- Immutable artifact reference (the package body lives in object storage).
-- One row per generated package; re-execution => a new version, never update.
-- =====================================================================

create table if not exists public.evidence_packages (
  id              uuid primary key default uuid_generate_v4(),
  application_id  uuid not null references public.applications on delete cascade,
  submission_session_id uuid references public.submission_sessions on delete set null,

  version         int not null default 1,

  consultant_id        uuid references public.users on delete set null,
  approval_timestamp   timestamptz,
  execution_timestamp  timestamptz,

  audit_hash      text not null,          -- chain head row_hash anchored at generation
  chain_verified  boolean not null default false,
  signature       text not null,          -- service signature over canonical package
  storage_path    text not null,          -- object-storage location of the package body
  region          text not null default 'global',  -- residency-bound

  extension_version text,
  schema_version    text,
  package_version   text not null default '1.0',
  hash_algo         text not null default 'sha256',
  canon_version     smallint not null default 1,

  generated_at    timestamptz not null default now(),

  unique (application_id, version)
);

create index if not exists evidence_packages_app_idx
  on public.evidence_packages (application_id, version desc);
create index if not exists evidence_packages_session_idx
  on public.evidence_packages (submission_session_id);

-- Immutability: evidence rows are write-once. Block UPDATE/DELETE (reuse the
-- audit no-mutate guard created in 20260606000004).
drop trigger if exists evidence_packages_no_update on public.evidence_packages;
create trigger evidence_packages_no_update
  before update on public.evidence_packages
  for each row execute function public.audit_no_mutate();

drop trigger if exists evidence_packages_no_delete on public.evidence_packages;
create trigger evidence_packages_no_delete
  before delete on public.evidence_packages
  for each row execute function public.audit_no_mutate();

alter table public.evidence_packages enable row level security;

drop policy if exists evidence_packages_owner_read on public.evidence_packages;
create policy evidence_packages_owner_read on public.evidence_packages
  for select using (
    auth.uid() = (select user_id from public.applications where id = application_id)
    or auth.uid() = consultant_id
  );
-- Writes via service role (evidence generator) only.

comment on table public.evidence_packages is
  'Gate 2: immutable, signed evidence-package references. Write-once; re-exec => new version. Service-role write.';

-- =====================================================================
-- ROLLBACK:
--   drop trigger if exists evidence_packages_no_update on public.evidence_packages;
--   drop trigger if exists evidence_packages_no_delete on public.evidence_packages;
--   drop table if exists public.evidence_packages;
-- =====================================================================
