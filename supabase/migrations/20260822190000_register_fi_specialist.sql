-- Register Finland's residence permit for a specialist (OLE_TY2).
--
-- THE OTHER SIDE OF A THRESHOLD THE REGISTRY ALREADY HOLDS
--
-- Migri writes on this page: "if your salary is less than eur 3,937, you should
-- apply for a residence permit for an employed person". fi-employed-person is
-- already registered, so VisaAI now holds BOTH sides of that split and can tell
-- an applicant which side they are on rather than showing them one page and
-- leaving them to discover the other.
--
-- The higher bar buys concrete things, and they are recorded as requirements
-- rather than left implicit: no labour market test, no supply contract, a
-- two-year first permit instead of one tied to the contract, two-week fast-track
-- eligibility, a LOWER fee (EUR 530 against EUR 750), and a 90-day exemption
-- from needing the permit at all.
--
-- AND ONE RULE IS INVERTED BETWEEN THE TWO PAGES
--
-- The employed-person permit allows fringe benefits to make up half the salary.
-- This one excludes them from the threshold entirely. Same authority, same
-- concept, opposite rule -- carrying either across would verify against nothing.

insert into public.visa_types (
  country_id, visaai_id, category, official_name, official_code, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'FI'),
  'fi-specialist', 'skilled_worker',
  'Residence permit application for persons employed as a specialist', 'OLE_TY2',
  'residence-permit-specialist',
  'Work in Finland in expert duties requiring special expertise, above Migri''s published salary threshold.',
  'active', 'unverified', '2026-08-23'::timestamptz
)
on conflict (visaai_id) do update set
  official_name = excluded.official_name,
  official_code = excluded.official_code,
  purpose = excluded.purpose,
  last_verified_at = excluded.last_verified_at;

insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language,
  robots_state, redistribution, check_interval, freshness_sla, active
)
select
  c.id, t.id, v.role,
  'Maahanmuuttovirasto (Finnish Immigration Service, Migri)', 1,
  v.url, v.url, v.title, 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from (values
  ('requirements', 'https://migri.fi/en/specialist',
   'Residence permit application for persons employed as a specialist'),
  ('eligibility', 'https://migri.fi/en/first-residence-permit',
   'First residence permit')
) as v(role, url, title)
join public.visa_types t on t.visaai_id = 'fi-specialist'
join public.visa_countries c on c.id = t.country_id and c.code = 'FI'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'fi-specialist' and s.active;
  if n <> 2 then raise exception 'Expected 2 active Migri sources, found %.', n; end if;
end $$;
