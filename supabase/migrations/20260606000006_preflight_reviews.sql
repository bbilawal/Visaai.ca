-- =====================================================================
-- Gate 2 — Phase 2A.7  preflight_reviews
-- Author: Database Architect   Date: 2026-06-06
-- Depends on: applications, submission_sessions, users, preflight_status enum
-- One row per preflight diff-review session. checklist must be all-true to
-- reach 'completed'; locked_diff_hash anchors the exact mapping reviewed.
-- =====================================================================

create table if not exists public.preflight_reviews (
  id              uuid primary key default uuid_generate_v4(),
  application_id  uuid not null references public.applications on delete cascade,
  submission_session_id uuid references public.submission_sessions on delete set null,

  status          preflight_status not null default 'in_review',
  reviewer_id     uuid references public.users on delete set null,  -- consultant (expert) or applicant
  reviewer_role   audit_actor_role,                                 -- 'consultant' | 'applicant'

  -- the six mandatory checks
  passport_reviewed       boolean not null default false,
  dates_reviewed          boolean not null default false,
  travel_history_reviewed boolean not null default false,
  addresses_reviewed      boolean not null default false,
  employment_reviewed     boolean not null default false,
  final_approval          boolean not null default false,

  locked_diff_hash text,            -- sha256 of the locked 3-col diff; null until completed
  extension_version text,
  schema_version    text,

  started_at      timestamptz not null default now(),
  completed_at    timestamptz,
  invalidated_at  timestamptz,

  -- completion integrity: 'completed' requires all six checks + a locked hash
  constraint preflight_completed_requires_all_checks
    check (
      status <> 'completed' or (
        passport_reviewed and dates_reviewed and travel_history_reviewed
        and addresses_reviewed and employment_reviewed and final_approval
        and locked_diff_hash is not null and completed_at is not null
      )
    )
);

create index if not exists preflight_reviews_app_idx
  on public.preflight_reviews (application_id, started_at desc);
create index if not exists preflight_reviews_session_idx
  on public.preflight_reviews (submission_session_id);

-- At most one IN_REVIEW preflight per application at a time.
create unique index if not exists preflight_reviews_one_inreview_uidx
  on public.preflight_reviews (application_id)
  where status = 'in_review';

alter table public.preflight_reviews enable row level security;

drop policy if exists preflight_reviews_owner_read on public.preflight_reviews;
create policy preflight_reviews_owner_read on public.preflight_reviews
  for select using (
    auth.uid() = (select user_id from public.applications where id = application_id)
    or auth.uid() = reviewer_id
  );
-- Writes via guarded preflight service / service role.

comment on table public.preflight_reviews is
  'Gate 2: mandatory preflight diff review. completed requires all 6 checks + locked_diff_hash. Service-role write.';

-- =====================================================================
-- ROLLBACK:
--   drop table if exists public.preflight_reviews;
-- =====================================================================
