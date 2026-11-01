-- =====================================================================
-- Gate 2 — Phase 2A.6  consultant_assignments + consultant_approvals
-- Author: Database Architect   Date: 2026-06-06
-- Depends on: applications, users, consultant_decision enum
-- Consultant = a user assigned to an application (Path 3 marketplace).
-- =====================================================================

-- ---- assignment (who may review which application) ----------------------
create table if not exists public.consultant_assignments (
  id              uuid primary key default uuid_generate_v4(),
  application_id  uuid not null references public.applications on delete cascade,
  consultant_id   uuid not null references public.users on delete cascade,
  status          text not null default 'active'
                    check (status in ('active','released')),
  assigned_at     timestamptz not null default now(),
  released_at     timestamptz,
  unique (application_id, consultant_id)
);

-- At most one ACTIVE consultant per application (marketplace MVP rule).
create unique index if not exists consultant_assignments_one_active_uidx
  on public.consultant_assignments (application_id)
  where status = 'active';

create index if not exists consultant_assignments_consultant_idx
  on public.consultant_assignments (consultant_id, status);

-- ---- approvals (field / section / application level) --------------------
create table if not exists public.consultant_approvals (
  id              uuid primary key default uuid_generate_v4(),
  application_id  uuid not null references public.applications on delete cascade,
  consultant_id   uuid not null references public.users on delete cascade,

  scope           text not null check (scope in ('field','section','application')),
  field_key       text,                          -- required when scope='field'
  section         text,                          -- required when scope='section'

  decision        consultant_decision not null,  -- reviewed | approved | rejected
  value_hash      text,                          -- value the consultant acted on (drift binding)
  reason          text,                          -- required for rejections (app-enforced)

  decided_at      timestamptz not null default now(),

  constraint consultant_approvals_scope_field
    check (scope <> 'field'   or field_key is not null),
  constraint consultant_approvals_scope_section
    check (scope <> 'section' or section   is not null)
);

create index if not exists consultant_approvals_app_idx
  on public.consultant_approvals (application_id, scope, decided_at desc);
create index if not exists consultant_approvals_app_field_idx
  on public.consultant_approvals (application_id, field_key);
create index if not exists consultant_approvals_consultant_idx
  on public.consultant_approvals (consultant_id, decided_at desc);

alter table public.consultant_assignments enable row level security;
alter table public.consultant_approvals   enable row level security;

-- Applicant reads assignments/approvals on their own application (transparency).
drop policy if exists consultant_assignments_owner_read on public.consultant_assignments;
create policy consultant_assignments_owner_read on public.consultant_assignments
  for select using (
    auth.uid() = (select user_id from public.applications where id = application_id)
    or auth.uid() = consultant_id
  );

drop policy if exists consultant_approvals_owner_read on public.consultant_approvals;
create policy consultant_approvals_owner_read on public.consultant_approvals
  for select using (
    auth.uid() = (select user_id from public.applications where id = application_id)
    or auth.uid() = consultant_id
  );
-- Writes via guarded service paths (assignment-checked) / service role.
-- A dedicated consultant DB role + write policies land with the consultant module.

comment on table public.consultant_approvals is
  'Gate 2: consultant review/approve/reject decisions, value_hash-bound. Append-style (new row per decision). Service-role write.';

-- =====================================================================
-- ROLLBACK:
--   drop table if exists public.consultant_approvals;
--   drop table if exists public.consultant_assignments;
-- =====================================================================
