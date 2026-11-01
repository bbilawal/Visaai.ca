-- Stale anonymous (guest) user cleanup.
--
-- The public intake funnel creates a real-but-anonymous auth.users row per guest
-- (is_anonymous = true). Abandoned guests accumulate; this reclaims them. Because
-- public.users -> auth.users and applications -> public.users are ON DELETE
-- CASCADE (and every child table cascades from applications), deleting the
-- auth.users row removes the guest's entire footprint in one statement.
--
-- A guest who signs up is upgraded IN PLACE (is_anonymous flips to false), so
-- this never touches a converted account.

create or replace function public.cleanup_stale_anonymous_users(
  p_age interval default '30 days'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  with removed as (
    delete from auth.users u
    where u.is_anonymous = true
      and coalesce(u.last_sign_in_at, u.created_at) < (now() - p_age)
    returning u.id
  )
  select count(*) into v_deleted from removed;

  return v_deleted;
end;
$$;

comment on function public.cleanup_stale_anonymous_users(interval) is
  'Deletes anonymous (guest) auth.users with no activity for p_age (default 30d). '
  'Cascades to public.users, applications, and all child rows. SECURITY DEFINER — '
  'owner must have DELETE on auth.users (postgres/supabase_admin via migrations).';

-- Restrict execution to privileged roles only; never expose to anon/authenticated.
revoke all on function public.cleanup_stale_anonymous_users(interval) from public;
revoke all on function public.cleanup_stale_anonymous_users(interval) from anon, authenticated;

-- ── Scheduling (ops) ────────────────────────────────────────────────────────
-- Enable pg_cron in the Supabase dashboard (Database -> Extensions), then run
-- the schedule below ONCE (kept out of this migration so it does not fail in
-- environments where pg_cron is not enabled):
--
--   select cron.schedule(
--     'cleanup-stale-anonymous-users',
--     '0 3 * * *',                                   -- daily 03:00 UTC
--     $$ select public.cleanup_stale_anonymous_users('30 days'); $$
--   );
--
-- Manual run / verification:
--   select public.cleanup_stale_anonymous_users('30 days');   -- returns row count
