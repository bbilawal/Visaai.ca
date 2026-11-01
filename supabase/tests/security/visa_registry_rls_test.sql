-- Visa registry RLS regression test.
--
-- Guards the defect fixed in 20260820150000_visa_registry_rls_fix.sql: the
-- core migration created five policies as `to authenticated using (true)`
-- under the name "staff_read". `authenticated` is every signed-up account, and
-- because PostgreSQL ORs permissive policies, that clause did not add a staff
-- path — it ORed away the `status = 'active'` restriction on the policy beside
-- it. One request to the browser-reachable PostgREST endpoint with an ordinary
-- user's own token would have returned every unreviewed draft requirement and
-- the whole internal review queue, reviewer ids and notes included.
--
-- This test asserts the three roles see exactly what they should. It runs in
-- the same CI step as rls_column_hardening_test.sql.
--
-- Run: psql -U postgres -d postgres -v ON_ERROR_STOP=1 < this file
-- Any assertion failure raises and fails the build.

\set ON_ERROR_STOP on

begin;

-- ---------------------------------------------------------------------------
-- Fixtures: one country, one visa type, one source, one version, and one
-- requirement in each of the three statuses.
-- ---------------------------------------------------------------------------

insert into public.visa_countries (code, name, slug, support_state)
values ('ZZ', 'RLS Test Land', 'rls-test-land', 'supported')
on conflict (code) do update set support_state = 'supported';

insert into public.visa_types (country_id, visaai_id, category, official_name, slug)
select id, 'zz-rls-test', 'visitor', 'RLS Test Visa', 'rls-test'
from public.visa_countries where code = 'ZZ'
on conflict (visaai_id) do nothing;

insert into public.visa_sources (country_id, visa_type_id, role, authority, canonical_url, source_url)
select c.id, t.id, 'landing', 'RLS Test Authority',
       'https://rls.test/visa', 'https://rls.test/visa'
from public.visa_countries c
join public.visa_types t on t.country_id = c.id and t.visaai_id = 'zz-rls-test'
where c.code = 'ZZ'
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid))
do nothing;

insert into public.visa_source_versions
  (source_id, version_number, raw_sha256, normalized_sha256, is_active)
select id, 1, repeat('a', 64), repeat('b', 64), true
from public.visa_sources where source_url = 'https://rls.test/visa'
on conflict do nothing;

insert into public.visa_requirements
  (visa_type_id, requirement_code, kind, label, source_version_id, status, source_excerpt)
select t.id, s.code, 'evidence', 'RLS fixture ' || s.code, v.id, s.code,
       'INTERNAL EXCERPT — must never reach a non-admin'
from public.visa_types t,
     public.visa_source_versions v,
     (values ('draft'), ('active'), ('retired')) as s(code)
where t.visaai_id = 'zz-rls-test'
  and v.source_id = (select id from public.visa_sources where source_url = 'https://rls.test/visa')
on conflict do nothing;

insert into public.visa_source_changes
  (source_id, to_version_id, classification, requires_review, review_note)
select s.id, v.id, 'material', true, 'INTERNAL REVIEW NOTE — must never reach a non-admin'
from public.visa_sources s
join public.visa_source_versions v on v.source_id = s.id
where s.source_url = 'https://rls.test/visa';

-- ---------------------------------------------------------------------------
-- anon: the public visa pages. Reference data yes, drafts and internals no.
-- ---------------------------------------------------------------------------

do $$
declare n int;
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);

  select count(*) into n from public.visa_countries where code = 'ZZ';
  if n <> 1 then
    raise exception 'anon must be able to read visa_countries (public visa pages render from it); saw %', n;
  end if;

  select count(*) into n from public.visa_types where visaai_id = 'zz-rls-test';
  if n <> 1 then
    raise exception 'anon must be able to read visa_types; saw %', n;
  end if;

  select count(*) into n from public.visa_requirements where status = 'active'
    and requirement_code = 'active';
  if n <> 1 then
    raise exception 'anon must be able to read ACTIVE requirements; saw %', n;
  end if;

  select count(*) into n from public.visa_requirements where status <> 'active'
    and requirement_code in ('draft', 'retired');
  if n <> 0 then
    raise exception 'anon read % non-active requirement(s) — unreviewed extraction is public', n;
  end if;

  select count(*) into n from public.visa_source_versions;
  if n <> 0 then
    raise exception 'anon read % source version row(s)', n;
  end if;

  select count(*) into n from public.visa_source_changes;
  if n <> 0 then
    raise exception 'anon read % review-queue row(s) — internal notes are public', n;
  end if;

  perform set_config('role', 'postgres', true);
end $$;

-- ---------------------------------------------------------------------------
-- authenticated, no admin role: an ordinary signed-up account.
-- This is the role the original policy handed everything to.
-- ---------------------------------------------------------------------------

do $$
declare n int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","app_metadata":{}}',
    true);

  select count(*) into n from public.visa_requirements where requirement_code = 'draft';
  if n <> 0 then
    raise exception
      'REGRESSION: an ordinary authenticated user read % DRAFT requirement(s). '
      'A "staff_read" policy scoped `to authenticated using (true)` ORs away '
      'the status=active restriction for every signed-up account.', n;
  end if;

  select count(*) into n from public.visa_requirements where requirement_code = 'retired';
  if n <> 0 then
    raise exception 'REGRESSION: ordinary user read % retired requirement(s)', n;
  end if;

  select count(*) into n from public.visa_source_changes;
  if n <> 0 then
    raise exception
      'REGRESSION: ordinary user read % review-queue row(s), which carry '
      'reviewed_by staff ids and internal review_note text', n;
  end if;

  select count(*) into n from public.visa_source_versions;
  if n <> 0 then
    raise exception 'REGRESSION: ordinary user read % source version row(s)', n;
  end if;

  select count(*) into n from public.visa_sync_runs;
  if n <> 0 then
    raise exception 'REGRESSION: ordinary user read % sync run row(s)', n;
  end if;

  -- Still gets the public surface.
  select count(*) into n from public.visa_countries where code = 'ZZ';
  if n <> 1 then
    raise exception 'an ordinary user must still read public country data; saw %', n;
  end if;

  perform set_config('role', 'postgres', true);
end $$;

-- ---------------------------------------------------------------------------
-- admin: must still be able to run the review queue, or the fix broke the
-- feature instead of securing it.
-- ---------------------------------------------------------------------------

do $$
declare n int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated","app_metadata":{"role":"admin"}}',
    true);

  select count(*) into n from public.visa_requirements where requirement_code = 'draft';
  if n <> 1 then
    raise exception 'an admin MUST be able to read draft requirements to review them; saw %', n;
  end if;

  select count(*) into n from public.visa_source_changes;
  if n < 1 then
    raise exception 'an admin MUST be able to read the review queue; saw %', n;
  end if;

  perform set_config('role', 'postgres', true);
end $$;

-- ---------------------------------------------------------------------------
-- No role may write. Writes are service-role only, via the sync job.
-- ---------------------------------------------------------------------------

do $$
declare ok boolean := false;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated","app_metadata":{"role":"admin"}}',
    true);
  begin
    insert into public.visa_countries (code, name, slug) values ('YY', 'Nope', 'nope');
  exception when others then
    ok := true;
  end;
  perform set_config('role', 'postgres', true);
  if not ok then
    raise exception 'an admin JWT was able to INSERT a country directly; writes must be service-role only';
  end if;
end $$;

rollback;

\echo 'visa_registry_rls_test: all assertions passed'
