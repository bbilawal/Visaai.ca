-- Register IRCC's Express Entry "get your documents ready" page for
-- ca-express-entry, so its checklist can carry the documents IRCC lists.
-- Date: 2026-10-19
--
-- WHY
--
-- ca-express-entry had no upload slots in the registry: its only `evidence`
-- row was the landing page's one-line summary ("get your documents ready
-- language test, education, job offer, funds, police certificates"). So every
-- Express Entry checklist came from the discovery LLM call (9-21s), see
-- apps/api/src/modules/intake/graphs/nodes/update-checklist.ts.
--
-- The documents themselves are listed on a separate IRCC page, registered
-- here as role `documents` (page dated 2026-10-16):
--
--   "You may need information from some or all of these documents when you
--    create a profile: a passport or travel document ... language test
--    results ... proof of funds police certificates provincial nomination
--    (if you applied for the Provincial Nominee Program)"
--
-- ORDER (each step depends on the previous):
--   1. this file
--   2. run the registry sync ON THE VPS so the new source gets an active
--      version (scripts/visa-sync-run.ts) -- the requirement migration binds
--      to that version and refuses to run without it
--   3. 20261019120100_req_ca_express_entry_v2.sql + 20261019120200_promote_ca_express_entry_v2.sql
--      (apply together, in one psql -1 run each, back to back)
--
-- Apply (not applied by this PR):
--   docker exec -i selfhosted_db psql -U supabase_admin -d postgres -1 < this file

insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language,
  robots_state, redistribution, check_interval, freshness_sla, active
)
select
  c.id, t.id, v.role,
  'Immigration, Refugees and Citizenship Canada', 1,
  v.url, v.url, v.title, 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from (values
  ('documents',
   'https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry/documents.html',
   'Express Entry: get your documents ready')
) as v(role, url, title)
join public.visa_types t on t.visaai_id = 'ca-express-entry'
join public.visa_countries c on c.id = t.country_id and c.code = 'CA'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'ca-express-entry' and s.active;
  if n <> 4 then raise exception 'Expected 4 active IRCC sources for ca-express-entry, found %.', n; end if;
end $$;
