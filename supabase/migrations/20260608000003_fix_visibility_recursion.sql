-- =====================================================================
-- Fix RLS recursion between applications ⇄ consultant_assignments.
-- Author: Security & RBAC   Date: 2026-06-08
--
-- The country-visibility policy (20260608000002) subqueried
-- consultant_assignments directly; that table's own SELECT policy subqueries
-- applications (owner check) → infinite recursion (42P17). Replace the inline
-- subqueries with SECURITY DEFINER helpers that read the tables WITHOUT RLS,
-- breaking the cycle. The helpers return only booleans / a country code.
-- =====================================================================

create or replace function public.app_has_active_consultant(p_app uuid)
  returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.consultant_assignments a
    where a.application_id = p_app and a.status = 'active'
  );
$$;

create or replace function public.is_active_assignee(p_app uuid, p_uid uuid)
  returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.consultant_assignments a
    where a.application_id = p_app and a.consultant_id = p_uid and a.status = 'active'
  );
$$;

create or replace function public.consultant_covers_country(p_uid uuid, p_country text)
  returns boolean language sql stable security definer set search_path = public as $$
  select p_country is not null and exists (
    select 1 from public.consultant_countries cc
    where cc.consultant_id = p_uid and cc.active = true and cc.country_code = p_country
  );
$$;

create or replace function public.app_destination_country(p_app uuid)
  returns text language sql stable security definer set search_path = public as $$
  select destination_country from public.applications where id = p_app;
$$;

grant execute on function public.app_has_active_consultant(uuid) to authenticated, anon;
grant execute on function public.is_active_assignee(uuid, uuid) to authenticated, anon;
grant execute on function public.consultant_covers_country(uuid, text) to authenticated, anon;
grant execute on function public.app_destination_country(uuid) to authenticated, anon;

-- ── applications SELECT (recursion-free via helpers) ──────────────────
drop policy if exists applications_owner_consultant_admin_select on public.applications;
create policy applications_owner_consultant_admin_select on public.applications
  for select using (
    auth.uid() = user_id
    or (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
    or public.is_active_assignee(applications.id, auth.uid())
    or (
      not public.app_has_active_consultant(applications.id)
      and public.consultant_covers_country(auth.uid(), applications.destination_country)
    )
  );

-- ── consultant self-insert (recursion-free via helpers) ───────────────
drop policy if exists consultant_assignments_self_insert on public.consultant_assignments;
create policy consultant_assignments_self_insert on public.consultant_assignments
  for insert with check (
    auth.uid() = consultant_id
    and status = 'active'
    and not public.app_has_active_consultant(application_id)
    and public.consultant_covers_country(
      auth.uid(),
      public.app_destination_country(application_id)
    )
  );

-- ROLLBACK:
--   drop policy if exists applications_owner_consultant_admin_select on public.applications;
--   drop policy if exists consultant_assignments_self_insert on public.consultant_assignments;
--   drop function if exists public.app_has_active_consultant(uuid);
--   drop function if exists public.is_active_assignee(uuid, uuid);
--   drop function if exists public.consultant_covers_country(uuid, text);
--   drop function if exists public.app_destination_country(uuid);
