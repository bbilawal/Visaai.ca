-- Register two more IRCC pages for Canada's Super Visa, so its checklist can
-- carry the applicant's PASSPORT and the IMM 5257 application form.
-- Date: 2026-10-16  (real-user dry run, prod app 61f16bb5)
--
-- WHY
--
-- The super visa checklist had no passport slot and no application form. Every
-- super visa requirement is quoted from one of four super-visa pages, and none
-- of the four states either: the forms-and-documents page lists only the
-- route-specific evidence (invitation letter, insurance, medical exam, host
-- status, relationship). The passport and the form are stated on two OTHER
-- IRCC pages, which this registers for ca-super-visa:
--
--   application  super visa "how to apply / start your application" page:
--                "There must be at least one blank page (other than the last
--                page) available on your passport so we can stamp it."
--   forms        the IMM 5257 page, whose purpose-of-visit list names
--                "Super visa — Parents and grandparents" -- the super visa is
--                applied for on the visitor visa application.
--
-- The IMM 5257 page is already registered for the visitor visa. Since
-- 20260820160000 a shared page has one visa_sources row per visa type, so this
-- adds the super visa's own row rather than borrowing the visitor visa's.
--
-- ORDER (each step depends on the previous):
--   1. this file
--   2. run the registry sync ON THE VPS so both new sources get an active
--      version (scripts/visa-sync-run.ts) -- the requirement migration binds
--      to that version and refuses to run without it
--   3. 20261016120100_req_ca_super_visa_v2.sql + 20261016120200_promote_ca_super_visa_v2.sql
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
  ('application',
   'https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/parent-grandparent-super-visa/apply/start-application.html',
   'Super visa: start your application'),
  ('forms',
   'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/imm5257.html',
   'Application for visitor visa (temporary resident visa) (IMM 5257)')
) as v(role, url, title)
join public.visa_types t on t.visaai_id = 'ca-super-visa'
join public.visa_countries c on c.id = t.country_id and c.code = 'CA'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'ca-super-visa' and s.active;
  if n <> 6 then raise exception 'Expected 6 active IRCC sources for ca-super-visa, found %.', n; end if;
end $$;
