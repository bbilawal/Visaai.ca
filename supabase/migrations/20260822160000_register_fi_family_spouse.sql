-- Register Finland's family-ties permit where the spouse holds a residence
-- permit. Finland's third visa type, and its first family route.
--
-- FOUR SOURCES FOR ONE PERMIT
--
-- Migri factors this permit across four pages and each carries something only
-- it states:
--
--   requirements  the route conditions (spouse page)
--   eligibility   the general entry conditions (first residence permit)
--   policy        the income thresholds, which are regional and NET
--   fees          the decree-based fee schedule
--
-- The fee is taken from the schedule rather than from the spouse page for a
-- specific reason recorded in the extraction file: the spouse page prints its
-- fee ABOVE both of its regime blocks, which puts it outside the bound that
-- keeps the superseded regime out.
--
-- WHY THE OTHER FAMILY ROUTES ARE NOT REGISTERED HERE
--
-- The hub lists cohabiting partner, spouse of a Finnish citizen, child,
-- guardian, other relative and adoption, each on its own page with its own
-- conditions. Registering them as one "family" type would repeat UDI's
-- concatenation trap by hand.

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'FI'),
  'fi-family-spouse', 'spouse_partner',
  'Residence permit application on the basis of family ties when your spouse has a residence permit',
  'family-ties-spouse-with-residence-permit',
  'Join a spouse or registered partner who holds a Finnish residence permit, or apply at the same time as they do.',
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
  'Maahanmuuttovirasto (Finnish Immigration Service, Migri)', 1,
  v.url, v.url, v.title, 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from (values
  ('requirements',
   'https://migri.fi/en/spouse-in-finland-with-a-residence-permit',
   'Spouse in Finland with a residence permit'),
  ('eligibility',
   'https://migri.fi/en/first-residence-permit',
   'First residence permit'),
  ('policy',
   'https://migri.fi/en/income-requirement-for-family-members-of-a-person-who-has-been-granted-a-residence-permit-in-finland',
   'Income requirement for family members of a person who has been granted a residence permit in Finland'),
  ('fees',
   'https://migri.fi/en/processing-fees-and-payment-methods',
   'Processing fees and payment methods')
) as v(role, url, title)
join public.visa_types t on t.visaai_id = 'fi-family-spouse'
join public.visa_countries c on c.id = t.country_id and c.code = 'FI'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'fi-family-spouse' and s.active;
  if n <> 4 then raise exception 'Expected 4 active Migri sources, found %.', n; end if;
end $$;
