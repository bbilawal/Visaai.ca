-- Add the Netherlands European Blue Card. NL now has 3 visa types.
--
-- Chosen over another US route deliberately. I first checked whether CBP could
-- unblock the US visitor visa the way it unblocked ESTA — it cannot. cbp.gov
-- covers ADMISSION (I-94, applying for admission, know before you visit), not
-- visa issuance, and there is no B-1/B-2 requirements page on it. travel.state.gov
-- remains the issuing authority and remains behind a 403, so the US visitor
-- visa stays genuinely blocked rather than being sourced from an agency that
-- does not set its rules.
--
-- WHY THE BLUE CARD IS WORTH ITS OWN VISA TYPE
--
-- It looks like a near-duplicate of the highly skilled migrant permit and is
-- not. IND states three differences plainly on this page, and each would send
-- someone down the wrong route:
--
--   * The employer does NOT need to be a recognised sponsor. For the highly
--     skilled migrant permit that is mandatory.
--   * The salary criterion is HIGHER than the highly skilled migrant reduced
--     criterion.
--   * It can lead to EU long-term residency after 2 years instead of 5.
--
-- The applicant may also apply themselves, unlike the highly skilled migrant
-- permit, which only a recognised sponsor can lodge.

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'NL'),
  'nl-european-blue-card', 'work',
  'European Blue Card residence permit', 'european-blue-card',
  'Work in the Netherlands as a highly educated employee from outside the '
    'EU, EEA or Switzerland, with a route to EU long-term residency after '
    '2 years.',
  'active', 'unverified', '2026-08-22'::timestamptz
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
  c.id, t.id, 'requirements', 'Immigratie- en Naturalisatiedienst (IND)', 1,
  'https://ind.nl/en/residence-permits/work/european-blue-card-residence-permit',
  'https://ind.nl/en/residence-permits/work/european-blue-card-residence-permit',
  'European Blue Card residence permit', 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from public.visa_types t
join public.visa_countries c on c.id = t.country_id and c.code = 'NL'
where t.visaai_id = 'nl-european-blue-card'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'nl-european-blue-card';
  if n < 1 then raise exception 'Blue Card source not registered.'; end if;
end $$;
