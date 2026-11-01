-- =====================================================================
-- Country-scoped consultant visibility — RLS (defense-in-depth).
-- Author: Security & RBAC   Date: 2026-06-08
-- Depends on: applications, consultant_assignments, consultant_countries
--
-- Primary enforcement remains the NestJS service layer (service-role path).
-- These policies protect the direct/user-JWT path so the SAME country rule
-- holds if the API layer is bypassed. Single source of truth for "assigned"
-- is consultant_assignments (active row); status is DERIVED, never stored.
-- =====================================================================

-- ── applications SELECT: owner OR admin OR active-assignee OR
--    (UNASSIGNED AND consultant covers the destination country) ──────────
drop policy if exists applications_owner_consultant_admin_select on public.applications;
create policy applications_owner_consultant_admin_select on public.applications
  for select using (
    auth.uid() = user_id
    or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    -- (a) the active assignee always sees their application
    or exists (
      select 1 from public.consultant_assignments a
      where a.application_id = applications.id
        and a.consultant_id = auth.uid()
        and a.status = 'active'
    )
    -- (b) an eligible consultant sees it ONLY while it is UNASSIGNED and the
    --     destination country is in their active country map
    or (
      applications.destination_country is not null
      and not exists (
        select 1 from public.consultant_assignments a2
        where a2.application_id = applications.id
          and a2.status = 'active'
      )
      and exists (
        select 1 from public.consultant_countries cc
        where cc.consultant_id = auth.uid()
          and cc.active = true
          and cc.country_code = applications.destination_country
      )
    )
  );

-- ── consultant_assignments INSERT: allow a consultant to self-assign an
--    UNASSIGNED application they are country-eligible for (in addition to
--    the existing owner/admin insert path). The DB partial-unique index
--    (one active per application) still guarantees race-safety. ───────────
drop policy if exists consultant_assignments_self_insert on public.consultant_assignments;
create policy consultant_assignments_self_insert on public.consultant_assignments
  for insert with check (
    -- self only
    auth.uid() = consultant_id
    and status = 'active'
    -- application currently unassigned
    and not exists (
      select 1 from public.consultant_assignments a
      where a.application_id = consultant_assignments.application_id
        and a.status = 'active'
    )
    -- country-eligible for this application's destination
    and exists (
      select 1
      from public.applications app
      join public.consultant_countries cc
        on cc.country_code = app.destination_country
      where app.id = consultant_assignments.application_id
        and cc.consultant_id = auth.uid()
        and cc.active = true
    )
  );

-- ROLLBACK:
--   drop policy if exists applications_owner_consultant_admin_select on public.applications;
--   create policy applications_owner_consultant_admin_select on public.applications
--     for select using (
--       auth.uid() = user_id
--       or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
--       or exists (select 1 from public.consultant_assignments a
--                  where a.application_id = applications.id
--                    and a.consultant_id = auth.uid() and a.status = 'active'));
--   drop policy if exists consultant_assignments_self_insert on public.consultant_assignments;
