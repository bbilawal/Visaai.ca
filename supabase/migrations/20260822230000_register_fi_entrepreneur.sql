-- Register Finland's residence permit for an entrepreneur (OLE_YRI).
--
-- THE REGISTRY'S FIRST ENTREPRENEUR ROUTE. Every published page so far has been
-- work, study, visitor, family or permanent residence; `entrepreneur` is a
-- category the schema has always allowed and nothing had ever used.
--
-- AND THE FIRST PERMIT DECIDED BY TWO AUTHORITIES IN SEQUENCE
--
-- Migri states that the application "will be processed in two stages": the
-- Economic Development Centre issues a partial decision on whether the business
-- is real and profitable, and only then does Migri process the permit. The
-- ordering has a consequence Migri also states -- failing the GENERAL
-- residence-permit requirements stops the Centre issuing a partial decision at
-- all -- so a passport or entry-record problem blocks the business assessment
-- before it begins. Both facts are stored as requirements.
--
-- The Centre's own profitability test is NOT stored. Migri says the Centre
-- assesses it and neither publishes the criteria; inventing one would be worse
-- than pointing at the authority.

insert into public.visa_types (
  country_id, visaai_id, category, official_name, official_code, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'FI'),
  'fi-entrepreneur', 'entrepreneur',
  'Residence permit application for an entrepreneur', 'OLE_YRI',
  'residence-permit-entrepreneur',
  'Come to Finland to run your own business, as a private trader, partner, unlimited-liability cooperative member, or managerial shareholder.',
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
  ('requirements', 'https://migri.fi/en/entrepreneur',
   'Residence permit application for an entrepreneur'),
  ('eligibility', 'https://migri.fi/en/first-residence-permit',
   'First residence permit')
) as v(role, url, title)
join public.visa_types t on t.visaai_id = 'fi-entrepreneur'
join public.visa_countries c on c.id = t.country_id and c.code = 'FI'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'fi-entrepreneur' and s.active;
  if n <> 2 then raise exception 'Expected 2 active Migri sources, found %.', n; end if;
end $$;
