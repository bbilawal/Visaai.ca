-- Account lifecycle state for admin user management (Phase 2).
alter table public.users
  add column status text not null default 'active'
    check (status in ('active','suspended','deleted')),
  add column status_reason text,
  add column status_changed_at timestamptz,
  add column status_changed_by uuid references public.users on delete set null;

create index users_status_idx on public.users (status) where status <> 'active';

-- Defense-in-depth: only the service role may mutate lifecycle columns. The RLS
-- policy `users_own_rows` (for all using auth.uid()=id) would otherwise let a
-- user flip their own status via a direct PostgREST UPDATE.
--
-- NOTE: a column-level `revoke update (status,...)` does NOT work here — in
-- Postgres a column-level REVOKE cannot subtract from a table-level grant, and
-- `authenticated` holds a table-level UPDATE on public.users (Supabase default).
-- Enforce the invariant with a BEFORE UPDATE trigger instead, mirroring
-- 20260612150000_fix_consultant_state_enforcement.sql. Any change to a lifecycle
-- column is rejected unless performed by the service role (the admin client used
-- by the admin-guarded AdminUsersService) or a superuser/migration role. Other
-- column updates (e.g. full_name, nationality) are unaffected.
create or replace function public.enforce_user_status_service_role()
returns trigger
language plpgsql
as $$
begin
  if (new.status            is distinct from old.status
   or new.status_reason     is distinct from old.status_reason
   or new.status_changed_at  is distinct from old.status_changed_at
   or new.status_changed_by  is distinct from old.status_changed_by)
     and current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'user lifecycle status may only be changed by an admin via the service role';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_user_status on public.users;
create trigger trg_enforce_user_status
  before update on public.users
  for each row execute function public.enforce_user_status_service_role();
