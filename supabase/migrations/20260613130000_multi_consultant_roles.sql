-- =====================================================================
-- Messaging P3c: multi-consultant (primary + backup) on consultant_assignments.
-- Adds a role column and swaps the "one active per app" partial unique index for
-- "one active PRIMARY per app" — multiple active backups are allowed. Existing
-- active rows become 'primary' (they are the sole active consultant). NO RLS
-- changes: is_active_assignee already matches any active row, so backups get the
-- same access as the primary by design.
-- Author: messaging P3c  Date: 2026-06-13
-- =====================================================================

alter table public.consultant_assignments
  add column role text not null default 'primary'
    check (role in ('primary','backup'));

-- Replace "one active per application" with "one active PRIMARY per application".
drop index if exists consultant_assignments_one_active_uidx;
create unique index consultant_assignments_one_active_primary_uidx
  on public.consultant_assignments (application_id)
  where status = 'active' and role = 'primary';

create index if not exists consultant_assignments_app_active_idx
  on public.consultant_assignments (application_id, status);
