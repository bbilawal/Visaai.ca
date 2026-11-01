-- =====================================================================
-- Phase 2 RBAC — Defense-in-depth RLS for consultant access.
-- Author: Security  Date: 2026-06-07
--
-- IMPORTANT: the API writes these tables via the SERVICE-ROLE client, which
-- BYPASSES RLS. These policies therefore protect the *direct / user-JWT* path
-- (anon-key client carrying a user token) — defense-in-depth for "API layer can
-- fail". The NestJS guards (OwnerOrAdminGuard + RolesGuard + assertAssigned)
-- remain the primary enforcement.
--
-- Admin is identified by the signed, server-only JWT claim:
--   auth.jwt() -> 'app_metadata' ->> 'role' = 'admin'
-- Additive: existing owner policies are left in place; these add consultant +
-- admin reach. Idempotent via drop-if-exists.
-- =====================================================================

-- helper predicate inlined (no SECURITY DEFINER function to keep surface small)

-- ── applications: owner OR assigned active consultant OR admin ────────────────
drop policy if exists applications_owner_consultant_admin_select on public.applications;
create policy applications_owner_consultant_admin_select on public.applications
  for select using (
    auth.uid() = user_id
    or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    or exists (
      select 1 from public.consultant_assignments a
      where a.application_id = applications.id
        and a.consultant_id = auth.uid()
        and a.status = 'active'
    )
  );

drop policy if exists applications_owner_consultant_admin_update on public.applications;
create policy applications_owner_consultant_admin_update on public.applications
  for update using (
    auth.uid() = user_id
    or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    or exists (
      select 1 from public.consultant_assignments a
      where a.application_id = applications.id
        and a.consultant_id = auth.uid()
        and a.status = 'active'
    )
  );

-- ── consultant_assignments: only OWNER or ADMIN may insert/update ─────────────
drop policy if exists consultant_assignments_owner_admin_insert on public.consultant_assignments;
create policy consultant_assignments_owner_admin_insert on public.consultant_assignments
  for insert with check (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    or auth.uid() = (select user_id from public.applications where id = application_id)
  );

drop policy if exists consultant_assignments_owner_admin_update on public.consultant_assignments;
create policy consultant_assignments_owner_admin_update on public.consultant_assignments
  for update using (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    or auth.uid() = (select user_id from public.applications where id = application_id)
  );

-- ── consultant_approvals: only the ASSIGNED active consultant (or admin) writes ─
drop policy if exists consultant_approvals_assigned_insert on public.consultant_approvals;
create policy consultant_approvals_assigned_insert on public.consultant_approvals
  for insert with check (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    or (
      auth.uid() = consultant_id
      and exists (
        select 1 from public.consultant_assignments a
        where a.application_id = consultant_approvals.application_id
          and a.consultant_id = auth.uid()
          and a.status = 'active'
      )
    )
  );

-- ROLLBACK:
--   drop policy if exists applications_owner_consultant_admin_select on public.applications;
--   drop policy if exists applications_owner_consultant_admin_update on public.applications;
--   drop policy if exists consultant_assignments_owner_admin_insert on public.consultant_assignments;
--   drop policy if exists consultant_assignments_owner_admin_update on public.consultant_assignments;
--   drop policy if exists consultant_approvals_assigned_insert on public.consultant_approvals;
