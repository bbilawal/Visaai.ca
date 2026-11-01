-- Egypt: the 16th destination, and the first with a one-entry catalogue.
--
-- WHY ONE ROUTE AND NOT TWO
--
-- The e-Visa portal enumerates its catalogue under the heading "types of visa
-- and fees" and that catalogue has exactly ONE entry: "1. tourism visa: issued
-- for single or multiple entries". Two fee lines follow it — 30$ and 65$.
--
-- Single and multiple entry are therefore a PRICE, not a category, and the
-- assertion at the bottom of this file holds Egypt at one route so a later
-- extraction cannot quietly split the tariff into two visa types. Austria's
-- mirror image of this problem was thirteen index URLs of which two were
-- occupation lists: an index tells you what exists, not what is a route.
--
-- WHY THE FEE CURRENCY IS USD AND NOT EGP
--
-- `fee_currency` records the currency this authority actually charges in, not
-- the country's domestic currency. The portal prices both variants in dollars.
-- Storing EGP here would be true about Egypt and false about the fee, and the
-- fee is what the column exists to render.
--
-- WHAT IS DELIBERATELY NOT REGISTERED
--
-- Work, study and residence routes. This authority is the Ministry of the
-- Interior's e-Visa system; it publishes short-stay entry and nothing else, and
-- no official index for the other routes was found from it. The catalogue claim
-- is scoped to this portal rather than to Egyptian entry policy as a whole.

update public.visa_countries
   set support_state             = 'supported',
       immigration_authority     = 'Ministry of Interior — Arab Republic of Egypt',
       immigration_authority_url = 'https://visa2egypt.gov.eg/eVisa/Home',
       official_visa_url         = 'https://visa2egypt.gov.eg/eVisa/Home',
       evisa_portal_url          = 'https://visa2egypt.gov.eg/eVisa/Home',
       official_languages        = array['ar','en'],
       fee_currency              = 'USD',
       data_quality              = 'unverified',
       last_verified_at          = '2026-08-26'::timestamptz
 where code = 'EG';

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'EG'),
  'eg-tourism-evisa', 'evisa',
  'Tourism Visa (e-Visa)',
  'tourism-evisa',
  'Egypt''s online entry visa for tourism, issued for single or multiple entries to nationals whose passports require a visa, priced at 30 USD and 65 USD respectively and delivered as a download link.',
  'active', 'unverified', '2026-08-26'::timestamptz
)
on conflict (visaai_id) do update set
  official_name    = excluded.official_name,
  purpose          = excluded.purpose,
  last_verified_at = excluded.last_verified_at;

insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language,
  robots_state, redistribution, check_interval, freshness_sla, active
)
select
  c.id, t.id, 'requirements',
  'Ministry of Interior — Arab Republic of Egypt', 1,
  'https://visa2egypt.gov.eg/eVisa/FAQ',
  'https://visa2egypt.gov.eg/eVisa/FAQ',
  'Egypt e-Visa portal — FAQ, types of visa and fees, entry requirements', 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from public.visa_countries c
join public.visa_types t on t.visaai_id = 'eg-tourism-evisa'
where c.code = 'EG'
on conflict do nothing;

-- Assert what this migration claims, before it commits.
do $$
declare
  n_country integer;
  n_type    integer;
  n_source  integer;
  n_total   integer;
begin
  select count(*) into n_country from public.visa_countries
   where code = 'EG' and support_state = 'supported'
     and immigration_authority is not null and fee_currency = 'USD';
  if n_country <> 1 then
    raise exception 'EG is not registered as a supported country with an authority and a USD tariff (found %)', n_country;
  end if;

  select count(*) into n_type from public.visa_types
   where visaai_id = 'eg-tourism-evisa' and lifecycle_state = 'active';
  if n_type <> 1 then
    raise exception 'Expected 1 active eg-tourism-evisa visa type, found %', n_type;
  end if;

  select count(*) into n_source from public.visa_sources s
    join public.visa_types t on t.id = s.visa_type_id
   where t.visaai_id = 'eg-tourism-evisa' and s.active;
  if n_source <> 1 then
    raise exception 'Expected 1 active source for eg-tourism-evisa, found %', n_source;
  end if;

  -- Egypt is ONE route. If this ever reads two, somebody has registered the
  -- single-entry and multiple-entry FEES as separate visa types.
  select count(*) into n_total from public.visa_types t
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'EG' and t.lifecycle_state = 'active';
  if n_total <> 1 then
    raise exception 'Egypt publishes ONE route (single/multiple entry is a fee, not a category); found %', n_total;
  end if;

  raise notice 'Egypt registered: 1 route, 1 source, awaiting sync';
end $$;
