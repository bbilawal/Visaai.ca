-- Task 14 — close an RLS bypass in the section_verification view.
--
-- THE DEFECT
--
-- `20260606000003_field_verifications.sql` does two things that only work
-- together if the view cooperates:
--
--   create or replace view public.section_verification as
--     select application_id, section, min(state), ... from public.field_verifications ...
--
--   alter table public.field_verifications enable row level security;
--   create policy field_verifications_owner_read ... using (
--     auth.uid() = (select user_id from public.applications where id = application_id)
--   );
--
-- The policy restricts `field_verifications` to the owning applicant. The view
-- reads the same table — but a Postgres view runs with the privileges of its
-- OWNER (here `postgres`) unless `security_invoker` is set. So the view does not
-- apply the caller's RLS, and every row of `field_verifications` is readable
-- through it by anyone who can reach PostgREST.
--
-- Anonymous sign-ins are enabled on this project, so "anyone" means any visitor:
-- sign up anonymously, get a valid `authenticated` JWT, select from the view.
--
-- CONFIRMED ON PRODUCTION, not inferred. A freshly created anonymous identity
-- owning nothing:
--
--   GET /rest/v1/users?select=id                 → 1 row  (its own — RLS correct)
--   GET /rest/v1/applications?select=*           → 0 rows (RLS correct)
--   GET /rest/v1/section_verification?select=*   → 1 row  ← another tenant's data
--
-- Exposed: `application_id`, `section`, and per-section verification progress
-- for every application in the system. Not document contents, but it discloses
-- which applications exist and how far along each is — and `application_id` is
-- the join key used elsewhere. The impact scales with the number of real users,
-- which is precisely why it must be fixed before a beta rather than after.
--
-- THE FIX
--
-- `security_invoker = true` (PostgreSQL 15+; this project runs 17) makes the
-- view evaluate under the CALLER's privileges, so `field_verifications_owner_read`
-- applies as originally intended.
--
-- WHY THIS IS SAFE FOR THE APPLICATION
--
-- The only consumer is `VerificationRepository.getSectionRollup`, which reads
-- through `this.supabase.admin` — the service-role client. Service role bypasses
-- RLS regardless, so its behaviour is unchanged. A user-scoped caller now
-- correctly sees only their own sections instead of everyone's.
--
-- THE OTHER TWO
--
-- A lint added to `infra/scripts/schema-rebuild-test.sh` at the same time found
-- that 3 of the 4 public views had the same defect:
--
--   section_verification      DEFINER  → CONFIRMED leaking to an anonymous guest
--   ai_cost_actual_vs_model   DEFINER  → not currently reachable (PostgREST returns
--                                        42501: no grant to anon/authenticated).
--                                        Latent: one GRANT away from exposing every
--                                        application's visa type, country and AI cost
--   v_application_funnel      DEFINER  → returned 0 rows only because the underlying
--                                        data is empty. Latent
--   application_activity      invoker  → correct
--
-- So this is applied to every view rather than to the one that happened to be
-- exploitable on the day it was looked at. The loop also covers views added
-- later that forget the option; the CI lint fails the build if one appears.
--
-- ROLLBACK: alter view <name> set (security_invoker = false);

do $$
declare
  v record;
begin
  for v in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'v'
      and not coalesce(
        (select option_value::boolean
           from pg_options_to_table(c.reloptions)
          where option_name = 'security_invoker'), false)
  loop
    execute format('alter view public.%I set (security_invoker = true)', v.relname);
  end loop;
end;
$$;

comment on view public.section_verification is
  'Section rollup over field_verifications. security_invoker=true — the view MUST '
  'evaluate under the caller''s RLS, otherwise it re-exposes every tenant''s rows '
  '(the underlying table is owner-read only). Do not remove.';
