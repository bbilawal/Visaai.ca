-- Three more Austrian routes: EU Blue Card, Start-up Founders, and Skilled
-- Workers in Shortage Occupations. All enumerated from the same server-rendered
-- index that produced the first.
--
-- WHY THE EU BLUE CARD IS THE INTERESTING ONE
--
-- Its income floor is the only Austrian figure found so far that the page states
-- WITH its year: "in 2026: at least € 55,678". The amount is indexed, so quoting
-- it bare would make an annually-revised threshold look permanent. It is quoted
-- with the year attached, which also gives this one page the freshness signal the
-- rest of migration.gv.at lacks.
--
-- THRESHOLDS ARE QUOTABLE; THE TABLE IS NOT
--
-- Start-up Founders states "50 points minimum" and Skilled Workers "a minimum of
-- 55 points" in prose, so both are quoted. The per-criterion scores behind those
-- totals are still not extractable — normalization flattens the table rows and
-- the criterion-to-score mapping survives only in visual layout. A sentence can
-- be quoted; a layout cannot.
--
-- AND ONE CLAUSE MOST SUMMARIES DROP
--
-- The shortage-occupation pay condition is not a figure but a standard: whatever
-- law, regulation or collective agreement stipulates. It then adds that where
-- overpay is customary in that company, it must be granted to the applicant too.
-- That sentence is the difference between the legal minimum and what colleagues
-- actually earn.

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
)
select
  (select id from public.visa_countries where code = 'AT'),
  v.visaai_id, v.category, v.official_name, v.slug, v.purpose,
  'active', 'unverified', '2026-08-25'::timestamptz
from (values
  ('at-eu-blue-card', 'work', 'EU Blue Card', 'eu-blue-card',
   'Austrian residence and work permit for graduates with a three-year tertiary qualification earning at least the national full-time average income.'),
  ('at-rwr-start-up-founders', 'business', 'Red-White-Red Card – Start-up Founders', 'red-white-red-card-start-up-founders',
   'Austrian work and residence permit for founders with at least EUR 30,000 of company capital, a 50% equity share and a qualifying points score.'),
  ('at-rwr-skilled-shortage', 'work', 'Red-White-Red Card – Skilled Workers in Shortage Occupations', 'red-white-red-card-skilled-workers-shortage-occupations',
   'Austrian work and residence permit for skilled workers in shortage occupations, requiring a binding job offer at the legally stipulated pay and a qualifying points score.')
) as v(visaai_id, category, official_name, slug, purpose)
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
  'Migration Platform of the Austrian Federal Government', 1,
  v.url, v.url, v.title, 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from (values
  ('at-eu-blue-card',
   'https://www.migration.gv.at/en/types-of-immigration/permanent-immigration/eubluecard/', 'EU Blue Card'),
  ('at-rwr-start-up-founders',
   'https://www.migration.gv.at/en/types-of-immigration/permanent-immigration/start-up-founders/', 'Start-up Founders'),
  ('at-rwr-skilled-shortage',
   'https://www.migration.gv.at/en/types-of-immigration/permanent-immigration/skilled-workers-in-shortage-occupations/', 'Skilled Workers in Shortage Occupations')
) as v(visaai_id, url, title)
join public.visa_types t on t.visaai_id = v.visaai_id
join public.visa_countries c on c.id = t.country_id
on conflict do nothing;

do $$
declare n_t integer; n_s integer; n_p integer;
begin
  select count(*) into n_t from public.visa_types
   where visaai_id in ('at-eu-blue-card','at-rwr-start-up-founders','at-rwr-skilled-shortage')
     and lifecycle_state = 'active';
  if n_t <> 3 then raise exception 'Expected 3 new Austrian visa types, found %', n_t; end if;

  select count(*) into n_s from public.visa_sources s
    join public.visa_types t on t.id = s.visa_type_id
   where t.visaai_id in ('at-eu-blue-card','at-rwr-start-up-founders','at-rwr-skilled-shortage')
     and s.active;
  if n_s <> 3 then raise exception 'Expected 3 new Austrian sources, found %', n_s; end if;

  select count(*) into n_p from public.visa_publishable_pages
   where visaai_id in ('at-eu-blue-card','at-rwr-start-up-founders','at-rwr-skilled-shortage');
  if n_p <> 0 then raise exception '% page(s) publishable before promotion', n_p; end if;

  raise notice 'Three Austrian routes registered: 3 types, 3 sources, 0 publishable (as expected)';
end $$;
