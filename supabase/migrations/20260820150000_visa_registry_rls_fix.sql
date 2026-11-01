-- Restrict the visa registry's operational tables to admins.
--
-- THE DEFECT
--
-- 20260820120000_visa_registry_core.sql created five policies of the form
--
--     create policy visa_requirements_staff_read on public.visa_requirements
--       for select to authenticated using (true);
--
-- "staff_read" was the intent. `to authenticated` is not staff — it is every
-- signed-up account, including a free one created thirty seconds ago. And
-- because PostgreSQL ORs permissive policies together, that policy did not
-- merely add a staff path: it ORed away the `status = 'active'` restriction on
-- the policy two lines above it, so the public-facing restriction became
-- decorative for anyone holding any JWT.
--
-- The browser-reachable PostgREST endpoint (apps/web/lib/supabase/client.ts)
-- means exploiting it takes one request with the user's own token:
--
--     GET /rest/v1/visa_requirements?select=*
--         -> every draft and retired requirement, including 4000-char
--            source_excerpt fields from unreviewed extraction
--     GET /rest/v1/visa_source_changes?select=*
--         -> internal review_note text and reviewed_by staff user ids
--
-- Nothing is exposed today because those tables are still empty — the seed
-- writes zero requirement rows — so this is a defect fixed before it could
-- leak rather than a breach. It would have started leaking the day the first
-- extraction ran.
--
-- `anon` was never affected: the anon policies are correctly scoped, and
-- `security_invoker = true` on visa_publishable_pages is what stops an
-- anonymous caller counting draft rows through the view. Both stay as they are.
--
-- THE FIX
--
-- Replace `to authenticated using (true)` with the admin predicate this
-- repository already uses in 49 other policies:
--
--     (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
--
-- app_metadata rather than user_metadata specifically because app_metadata is
-- not writable by the user whose token it is.

-- Requirements: the public policy (status = 'active') stays untouched. The
-- staff policy is narrowed so it no longer ORs that restriction away for
-- ordinary accounts.
drop policy if exists visa_requirements_staff_read on public.visa_requirements;
create policy visa_requirements_admin_read on public.visa_requirements
  for select
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

-- Version history, check logs, run metrics and the review queue are
-- operational data. Nothing here is needed to render a public page, and the
-- review queue carries reviewer identities and internal notes.
drop policy if exists visa_source_versions_read on public.visa_source_versions;
create policy visa_source_versions_admin_read on public.visa_source_versions
  for select
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists visa_source_checks_read on public.visa_source_checks;
create policy visa_source_checks_admin_read on public.visa_source_checks
  for select
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists visa_sync_runs_read on public.visa_sync_runs;
create policy visa_sync_runs_admin_read on public.visa_sync_runs
  for select
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

drop policy if exists visa_source_changes_read on public.visa_source_changes;
create policy visa_source_changes_admin_read on public.visa_source_changes
  for select
  to authenticated
  using ((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin');

comment on table public.visa_source_changes is
  'Promotion queue for detected government changes. detected -> parsed -> '
  'validated -> tested -> approved -> active. Material changes always require '
  'human review before they reach a user. ADMIN-READ ONLY: carries reviewer '
  'identities and internal review notes.';
