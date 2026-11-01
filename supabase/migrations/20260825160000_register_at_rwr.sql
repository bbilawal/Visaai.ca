-- Register Austria and its Red-White-Red Card route for very highly qualified
-- workers. The 15th destination.
--
-- WHY AUSTRIA, AND WHY THIS ROUTE
--
-- migration.gv.at passed every probe gate: robots.txt with ZERO disallow lines,
-- requirement-shaped content at 93% unique lines, and — the gate Denmark failed —
-- an index that enumerates its routes SERVER-SIDE. Thirteen permanent-immigration
-- routes can be read off the site rather than constructed; this is the first.
--
-- THE FRESHNESS LIMITATION, STATED RATHER THAN BURIED
--
-- These pages publish no dateline and mention no year, and there is no
-- Last-Modified header or XML sitemap to substitute. A five-year-old page would
-- look identical to a current one.
--
-- That was very nearly treated as disqualifying. It is not, because it is
-- already true of sources this registry publishes today: check-source-freshness
-- reports '[none published]' for Singapore's MOM pages and the US ESTA pages
-- among others. The honest position is that Austria is no worse than the corpus
-- it joins, and the limitation is tracked by the freshness checker rather than
-- hidden by admitting the country quietly.
--
-- WHAT IS NOT REGISTERED, AND WHY IT MATTERS HERE
--
-- The POINTS TABLE. Admission to this route is scored across eight criteria, and
-- the criterion-to-score mapping is destroyed by normalization: the three age
-- brackets flatten to three consecutive lines followed by '20', '15', '10', so
-- the association survives only in the visual layout. Asserting 'under 35 = 20
-- points' would be inferring from position. The requirements registered below
-- are the documentary and procedural ones the page states in prose, and the
-- scoring is described as existing without being quantified.
--
-- This is the same shape as Denmark's problem — readable content whose STRUCTURE
-- is lost — except here it costs part of one route rather than the whole country.

update public.visa_countries
   set support_state             = 'supported',
       immigration_authority     = 'Migration Platform of the Austrian Federal Government',
       immigration_authority_url = 'https://www.migration.gv.at/en/',
       official_visa_url         = 'https://www.migration.gv.at/en/types-of-immigration/',
       official_languages        = array['de','en'],
       fee_currency              = 'EUR',
       data_quality              = 'unverified',
       last_verified_at          = '2026-08-25'::timestamptz
 where code = 'AT';

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'AT'),
  'at-rwr-very-highly-qualified', 'work',
  'Red-White-Red Card – Very Highly Qualified Workers',
  'red-white-red-card-very-highly-qualified-workers',
  'Austrian work and residence permit for very highly qualified workers, admitted on a points score across qualifications, salary, research, awards, experience, language, age and study in Austria.',
  'active', 'unverified', '2026-08-25'::timestamptz
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
  'Migration Platform of the Austrian Federal Government', 1,
  'https://www.migration.gv.at/en/types-of-immigration/permanent-immigration/very-highly-qualified-workers/',
  'https://www.migration.gv.at/en/types-of-immigration/permanent-immigration/very-highly-qualified-workers/',
  'Very Highly Qualified Workers', 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from public.visa_countries c
join public.visa_types t on t.visaai_id = 'at-rwr-very-highly-qualified'
where c.code = 'AT'
on conflict do nothing;

do $$
declare n_c integer; n_t integer; n_s integer; n_p integer;
begin
  select count(*) into n_c from public.visa_countries
   where code = 'AT' and support_state = 'supported' and immigration_authority is not null;
  if n_c <> 1 then raise exception 'AT not registered as supported with an authority (found %)', n_c; end if;

  select count(*) into n_t from public.visa_types
   where visaai_id = 'at-rwr-very-highly-qualified' and lifecycle_state = 'active';
  if n_t <> 1 then raise exception 'Expected 1 active Austrian visa type, found %', n_t; end if;

  select count(*) into n_s from public.visa_sources s
    join public.visa_types t on t.id = s.visa_type_id
   where t.visaai_id = 'at-rwr-very-highly-qualified' and s.active;
  if n_s <> 1 then raise exception 'Expected 1 active Austrian source, found %', n_s; end if;

  select count(*) into n_p from public.visa_publishable_pages
   where visaai_id = 'at-rwr-very-highly-qualified';
  if n_p <> 0 then raise exception 'Publishable before any requirement was promoted'; end if;

  raise notice 'Austria registered: 1 country, 1 visa type, 1 source, 0 publishable (as expected)';
end $$;
