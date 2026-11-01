-- =====================================================================
-- Representative dataset for performance work (PERF-001).
-- LOCAL / NON-PRODUCTION ONLY.
--
-- WHY: every performance finding so far has been unverifiable because the
-- database holds a handful of rows. A query plan against 1 application tells
-- you nothing — Postgres will seq-scan a 1-row table no matter how good your
-- index is, and an N+1 costs nothing when N is 1. PERF-001 has been open purely
-- for want of data.
--
-- Volumes are chosen to be the smallest that make plans behave like production:
-- past a few thousand rows the planner starts preferring indexes, so missing
-- ones become visible as seq scans instead of hiding behind "the table is tiny".
--
--   2,000 users · 5,000 applications · 25,000 checklist items
--   8,000 documents · 4,000 conversations · 60,000 messages
--
-- Guard: refuses to run against anything that looks like production.
-- =====================================================================

do $$
begin
  if current_setting('server_version_num')::int < 150000 then
    raise exception 'unexpected server version';
  end if;
  -- A production database has real auth users. This dataset is for a scratch
  -- stack; refuse if the shape suggests otherwise.
  --
  -- Seed users are excluded from the count deliberately: the script is meant to
  -- be re-runnable, and on the first version a partial run left 2,000 of its own
  -- rows behind and then refused to continue — the guard tripping over its own
  -- output. Real users are the signal; our own are not.
  if (select count(*) from auth.users where email not like '%@seed.local') > 50 then
    raise exception 'refusing to seed: auth.users has % non-seed rows — this does not look like a scratch database',
      (select count(*) from auth.users where email not like '%@seed.local');
  end if;
end $$;

-- Deterministic ids so the script is re-runnable and rows are identifiable.
-- 'perf' prefix makes cleanup a single predicate.
create temporary table seed_users as
select
  ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid as id,
  'perf-user-' || g || '@seed.local' as email
from generate_series(1, 2000) g;

-- The empty-string token columns are NOT optional padding.
--
-- GoTrue reads auth.users through a Go driver that scans these into plain
-- strings, and a NULL is a hard failure: "Scan error on column index 3, name
-- confirmation_token: converting NULL to string is unsupported". The whole
-- /admin/users endpoint then 500s at any page size large enough to include one
-- bad row — which broke GET /admin/consultants and, through it, the admin
-- applications page. It looked exactly like a product scalability defect.
-- GoTrue writes '' for these; a direct INSERT must do the same.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_anonymous,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  phone_change, phone_change_token, email_change_token_current,
  reauthentication_token
)
select
  '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated',
  email, crypt('seed-password', gen_salt('bf')),
  now(), now() - (random() * interval '365 days'), now(),
  '{"provider":"email","providers":["email"],"role":"user"}'::jsonb, '{}'::jsonb, false,
  '', '', '', '', '', '', '', ''
from seed_users
on conflict (id) do nothing;

-- public.users is populated by the handle_new_user trigger on auth.users; if a
-- row is missing (trigger disabled in some environments), backfill it.
insert into public.users (id, email, created_at)
select u.id, u.email, now() - (random() * interval '365 days')
from seed_users u
where not exists (select 1 from public.users p where p.id = u.id)
on conflict (id) do nothing;

-- Applications: skewed, not uniform. Most users have one; a few have many.
-- A uniform distribution hides the exact per-user hot spots that hurt.
insert into public.applications (id, user_id, destination_country, status, created_at)
select
  ('00000000-0000-4000-9000-' || lpad(g::text, 12, '0'))::uuid,
  (select id from seed_users order by (g * 7919 + s) % 2000 limit 1),
  (array['CA','US','GB','DE','FR','AU','NZ','IE'])[1 + (g % 8)],
  (array['draft','ready','submitted','decided'])[1 + (g % 4)],
  now() - (random() * interval '300 days')
from generate_series(1, 5000) g, lateral (select g as s) x
on conflict (id) do nothing;

insert into public.checklist_items (application_id, document_type, label, status, added_reason)
select a.id,
       'seed_doc_type_' || i,
       'Seed requirement ' || i,
       (array['missing','uploaded','verified'])[1 + (i % 3)],
       'seed'
from public.applications a
cross join generate_series(1, 5) i
where a.id::text like '00000000-0000-4000-9000-%';

insert into public.documents (application_id, file_name, storage_path, mime_type, upload_status, created_at)
select a.id,
       'seed-doc-' || i || '.pdf',
       a.user_id || '/' || a.id || '/seed-' || i || '.pdf',
       'application/pdf',
       'complete',
       now() - (random() * interval '200 days')
from public.applications a
cross join generate_series(1, 2) i
where a.id::text like '00000000-0000-4000-9000-%'
  and (a.created_at < now() - interval '30 days');

insert into public.conversations (id, application_id, created_at)
select ('00000000-0000-4000-a000-' || lpad(row_number() over (order by a.id)::text, 12, '0'))::uuid,
       a.id, a.created_at
from public.applications a
where a.id::text like '00000000-0000-4000-9000-%'
  and (a.status <> 'draft')
on conflict (id) do nothing;

insert into public.messages (conversation_id, sender_id, sender_role, body, created_at)
select c.id,
       a.user_id,
       (array['user','consultant'])[1 + (i % 2)],
       'Seed message ' || i || ' — representative body text for pagination and search timing.',
       c.created_at + (i * interval '1 hour')
from public.conversations c
join public.applications a on a.id = c.application_id
cross join generate_series(1, 15) i
where c.id::text like '00000000-0000-4000-a000-%';

analyze;
