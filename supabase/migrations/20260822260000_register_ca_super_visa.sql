-- Register Canada's Super Visa for parents and grandparents.
--
-- Canada's eighth visa type, and the registry's first `parent` route -- a
-- category the schema has always allowed and nothing had used.
--
-- WHY THIS ONE, NOW
--
-- The form-sweep evidence pass (20260822220000) found that ZERO of 166 IRCC
-- form findings are named on any page VisaAI tracks, and concluded that this
-- measures our Canadian source coverage rather than those forms' scope: we
-- track 6 canada.ca pages, not canada.ca. This adds four more, on a route with
-- real search demand and a requirement structure nothing else here has.
--
-- HALF THE REQUIREMENTS BIND SOMEBODY ELSE
--
-- IRCC splits the eligibility page into "host requirements" and "applicant
-- requirements". The host -- the child or grandchild in Canada -- must be a
-- citizen, permanent resident or registered Indian, be 18 or over, meet a
-- published income floor, and write and sign the invitation. An applicant who
-- satisfies every applicant requirement is refused if the host does not
-- qualify, and nothing on the applicant's side can fix it.
--
-- Those conditions are therefore stored as requirements in their own right,
-- labelled HOST. Folding them into the applicant's checklist would produce
-- items nobody reading it can act on; omitting them would produce a checklist
-- that is complete and still leads to a refusal.
--
-- FOUR PAGES, EACH CARRYING SOMETHING ONLY IT STATES
--
--   requirements  who can apply -- host and applicant conditions
--   documents     forms and documents -- insurance policy terms, proofs
--   policy        proof of financial support -- the income table
--   landing       how long you can stay -- five years per entry
--
-- The minimum-necessary-income table exists on exactly one of them. Same shape
-- as Finland's two-page permits, one level deeper.

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'CA'),
  'ca-super-visa', 'parent',
  'Super visa for parents and grandparents',
  'super-visa-parents-grandparents',
  'Visit a child or grandchild in Canada for up to five years per entry, on a multi-entry visa valid up to ten years.',
  'active', 'unverified', '2026-08-23'::timestamptz
)
on conflict (visaai_id) do update set
  official_name = excluded.official_name,
  purpose = excluded.purpose,
  last_verified_at = excluded.last_verified_at;

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
  ('requirements',
   'https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/parent-grandparent-super-visa/eligibility.html',
   'Super visa: who can apply'),
  ('documents',
   'https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/parent-grandparent-super-visa/forms-documents.html',
   'Super visa: forms and documents'),
  ('policy',
   'https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/parent-grandparent-super-visa/forms-documents/host-financial-support.html',
   'Super visa: proof of financial support'),
  ('landing',
   'https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/parent-grandparent-super-visa/length-stay-canada.html',
   'Super visa: how long you can stay')
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
  if n <> 4 then raise exception 'Expected 4 active IRCC sources, found %.', n; end if;
end $$;
