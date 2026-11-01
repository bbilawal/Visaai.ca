-- =====================================================================
-- Assignment SLA — review-deadline + completion + assigner attribution on
-- consultant_assignments.
-- Author: assignment-sla   Date: 2026-06-15
-- Depends on: public.consultant_assignments (20260606000005), public.users
--
-- A consultant who claims (or is assigned) an application gets a review window
-- (due_at, default 24h from assignment). If the window passes WITHOUT the
-- consultant marking it complete (completed_at), a lazy sweep releases the
-- assignment so the application returns to the unassigned queue. assigned_by +
-- assigned_by_role record WHO created the assignment (self vs admin) for the
-- applicant/admin "assigned by" column. All writes go via the service-role
-- ConsultantWriteClient, so no new RLS write policies are needed; the existing
-- owner/consultant SELECT policy already exposes these columns for transparency.
-- =====================================================================

alter table public.consultant_assignments
  add column if not exists due_at        timestamptz not null default (now() + interval '24 hours'),
  add column if not exists completed_at   timestamptz,
  add column if not exists assigned_by    uuid references public.users on delete set null,
  add column if not exists assigned_by_role text
    check (assigned_by_role is null or assigned_by_role in ('consultant','admin'));

-- Sweep target: active, not-completed, past-due rows. Partial index keeps the
-- expiry scan cheap as the table grows.
create index if not exists consultant_assignments_due_sweep_idx
  on public.consultant_assignments (due_at)
  where status = 'active' and completed_at is null;

comment on column public.consultant_assignments.due_at is
  'Review deadline. If still active + not completed past this, a sweep releases the assignment back to the queue.';
comment on column public.consultant_assignments.completed_at is
  'Set when the assigned consultant marks the application review complete — stops the SLA clock.';
comment on column public.consultant_assignments.assigned_by is
  'User who created this assignment (the consultant themselves for self-assign, or the admin who assigned it).';

-- =====================================================================
-- ROLLBACK:
--   drop index if exists public.consultant_assignments_due_sweep_idx;
--   alter table public.consultant_assignments
--     drop column if exists due_at,
--     drop column if exists completed_at,
--     drop column if exists assigned_by,
--     drop column if exists assigned_by_role;
-- =====================================================================
