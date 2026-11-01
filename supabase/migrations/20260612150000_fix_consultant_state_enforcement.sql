-- =====================================================================
-- Fix: enforce staff-only conversations.consultant_state writes with a trigger.
--
-- The P3a migration (20260612140000) used
--   revoke update (consultant_state) on public.conversations from authenticated;
-- but `authenticated` holds a TABLE-level UPDATE grant on conversations, and in
-- Postgres a column-level REVOKE cannot subtract from a table-level grant — so
-- the REVOKE was inert and an application owner could set consultant_state on
-- their own conversation via a direct PostgREST UPDATE (bypassing the staff-only
-- MessagingService.setConsultantState path).
--
-- Enforce the invariant with a BEFORE UPDATE trigger instead: any change to
-- consultant_state is rejected unless performed by the service-role (the admin
-- client used by the staff-guarded service) or a superuser/migration role.
-- Other column updates (e.g. status — Scenario 18) are unaffected.
-- Author: messaging P3a hardening  Date: 2026-06-12
-- =====================================================================

create or replace function public.enforce_consultant_state_service_role()
returns trigger
language plpgsql
as $$
begin
  if new.consultant_state is distinct from old.consultant_state
     and current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'consultant_state may only be changed by staff via the messaging service';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_consultant_state on public.conversations;
create trigger trg_enforce_consultant_state
  before update on public.conversations
  for each row execute function public.enforce_consultant_state_service_role();
