-- ============================================================
-- DESTRUCTIVE RESET — run ONLY on an empty/staging project.
-- Drops every object + ALL DATA in the public schema, plus the
-- auth.users signup trigger, so all_migrations.sql can apply clean.
-- Supabase-managed schemas (auth, storage, extensions) are untouched.
-- DO NOT run on a project with data you care about.
-- ============================================================

-- The signup trigger lives on auth.users (not public) — drop it explicitly,
-- else re-creating it in initial_schema fails with "already exists".
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user() cascade;

drop schema if exists public cascade;
create schema public;

-- Restore default grants Supabase expects on the public schema.
grant usage on schema public to anon, authenticated, service_role;
grant all on schema public to postgres, service_role;

-- ============================================================
-- After this runs successfully, run: supabase/all_migrations.sql
-- ============================================================
