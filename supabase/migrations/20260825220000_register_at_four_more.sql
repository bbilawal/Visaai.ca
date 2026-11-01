-- Four more Austrian routes, completing the work-and-settlement half of the
-- enumerable index: graduates, self-employed key workers, regular workers in
-- tourism/agriculture/forestry, and the Red-White-Red Card Plus.
--
-- WHAT EACH ONE ACTUALLY TURNS ON
--
-- Graduates: a comparative salary standard rather than a figure — what
-- comparable Austrian junior employees would receive — plus an upgrade path that
-- is the real point of the route: 21 months of qualifying employment inside a
-- 24-month window converts it to unlimited labour-market access.
--
-- Self-employed key workers: capital alone is not enough. The page ties the
-- transfer of investment capital to an EMPLOYMENT effect in one sentence, so it
-- is recorded as one requirement with two limbs rather than split into a capital
-- rule somebody could satisfy on its own.
--
-- Regular workers: a work history rather than a qualification. Seven months as a
-- registered seasonal worker in the SAME industry within two years, A1 German,
-- and a binding offer of PERMANENT employment — the last being what separates
-- this from simply continuing to work seasons.
--
-- Card Plus: three ALTERNATIVE routes in, not three conditions, and the third
-- depends on the first two. A family member qualifies only if their relative
-- falls within item 1 or 2, and only after twelve months' lawful settlement of
-- their own.
--
-- One excerpt is quoted with the authority's own spelling error ("wich is not
-- older than six month"). Correcting it silently would make the quotation no
-- longer a quotation.

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
)
select
  (select id from public.visa_countries where code = 'AT'),
  v.visaai_id, v.category, v.official_name, v.slug, v.purpose,
  'active', 'unverified', '2026-08-25'::timestamptz
from (values
  ('at-rwr-graduates', 'work', 'Red-White-Red Card – Graduates of Austrian Universities', 'red-white-red-card-graduates',
   'Austrian work and residence permit for graduates of Austrian higher education, requiring the customary graduate salary and, after 21 of 24 months qualifying employment, an upgrade to unlimited labour-market access.'),
  ('at-rwr-self-employed-key-workers', 'business', 'Red-White-Red Card – Self-employed Key Workers', 'red-white-red-card-self-employed-key-workers',
   'Austrian work and residence permit for self-employed key workers, requiring transferred investment capital together with the creation of new jobs or securing of existing jobs in Austria.'),
  ('at-rwr-regular-workers-seasonal', 'work', 'Red-White-Red Card – Regular Workers in Tourism, Agriculture and Forestry', 'red-white-red-card-regular-workers-tourism-agriculture-forestry',
   'Austrian work and residence permit converting registered seasonal work into permanent employment, requiring seven months prior seasonal work in the same industry, A1 German and a binding permanent job offer.'),
  ('at-rwr-card-plus', 'work', 'Red-White-Red Card Plus', 'red-white-red-card-plus',
   'Austrian residence permit with unlimited labour-market access, reached through two years lawful settlement with progressive integration, an existing work permit or exemption certificate, or family membership of someone in either group.')
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
  ('at-rwr-graduates', 'https://www.migration.gv.at/en/types-of-immigration/permanent-immigration/graduates/', 'Graduates of Austrian Universities'),
  ('at-rwr-self-employed-key-workers', 'https://www.migration.gv.at/en/types-of-immigration/permanent-immigration/self-employedkeyworkers/', 'Self-employed Key Workers'),
  ('at-rwr-regular-workers-seasonal', 'https://www.migration.gv.at/en/types-of-immigration/permanent-immigration/regular-workers-in-tourism-agriculture-and-forestry/', 'Regular Workers in Tourism, Agriculture and Forestry'),
  ('at-rwr-card-plus', 'https://www.migration.gv.at/en/types-of-immigration/permanent-immigration/redwhiteredcardplus/', 'Red-White-Red Card Plus')
) as v(visaai_id, url, title)
join public.visa_types t on t.visaai_id = v.visaai_id
join public.visa_countries c on c.id = t.country_id
on conflict do nothing;

do $$
declare n_t integer; n_s integer; n_p integer;
begin
  select count(*) into n_t from public.visa_types
   where visaai_id in ('at-rwr-graduates','at-rwr-self-employed-key-workers','at-rwr-regular-workers-seasonal','at-rwr-card-plus') and lifecycle_state = 'active';
  if n_t <> 4 then raise exception 'Expected 4 new Austrian visa types, found %', n_t; end if;

  select count(*) into n_s from public.visa_sources s
    join public.visa_types t on t.id = s.visa_type_id
   where t.visaai_id in ('at-rwr-graduates','at-rwr-self-employed-key-workers','at-rwr-regular-workers-seasonal','at-rwr-card-plus') and s.active;
  if n_s <> 4 then raise exception 'Expected 4 new Austrian sources, found %', n_s; end if;

  select count(*) into n_p from public.visa_publishable_pages
   where visaai_id in ('at-rwr-graduates','at-rwr-self-employed-key-workers','at-rwr-regular-workers-seasonal','at-rwr-card-plus');
  if n_p <> 0 then raise exception '% page(s) publishable before promotion', n_p; end if;

  raise notice 'Four Austrian routes registered: 4 types, 4 sources, 0 publishable (as expected)';
end $$;
