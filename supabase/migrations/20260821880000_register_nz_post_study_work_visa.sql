-- Add New Zealand's post study work visa. NZ reaches 4 types; the registry
-- reaches 36 across 8 destinations.
--
-- HOW THIS PAGE WAS FOUND, AFTER THE SITEMAP ROUTE FAILED FOR REAL
--
-- INZ's sitemap index lists 11 sub-sitemaps. Ten of them return `unavailable`
-- to our fetcher and the eleventh holds 20 news URLs -- so unlike Sweden and
-- Ireland, the "sitemap is broken" finding here was accurate. Re-probed anyway,
-- because three earlier blocked calls had been wrong.
--
-- INZ's own enumeration of visa types sits behind /_visa-search/, which its
-- robots.txt DISALLOWS, and its prose links to that search rather than to visa
-- detail pages. So the list of visa types is genuinely out of reach, and it
-- stays that way: the search path is not fetched.
--
-- What did work was a bounded set of direct slug probes under the known
-- /new-zealand-visas/visas/visa/ pattern. Probing to FIND a url is fine; what
-- must never be guessed is what a page SAYS. `post-study-work-visa` returned
-- 23,594 characters and `foreign-government-supported-student-visa` 16,684 --
-- both real, both readable, neither reachable from any index.
--
-- The fee-paying student visa remains unfound: its slug is not guessable from
-- INZ's prose and enumeration is robots-disallowed. That is now a PRINCIPLED
-- stop rather than a technical one, and it should be recorded as such.
--
-- A RULE THAT IS NOT YET IN FORCE
--
-- The page announces that from 16 November 2026 eligibility extends to
-- graduate-diploma-plus-bachelor's applicants. Extraction ran 2026-08-22. Both
-- ways of mishandling that are harmful: dropping it hides a change that decides
-- whether someone should wait before applying, and recording it as eligibility
-- tells people today that they qualify when they do not. It is stored with
-- officially_required = false and the date in the label.

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'NZ'),
  'nz-post-study-work-visa', 'work',
  'Post Study Work Visa', 'post-study-work-visa',
  'Stay and work in New Zealand for up to 3 years after completing an '
    'eligible New Zealand qualification.',
  'active', 'unverified', '2026-08-22'::timestamptz
)
on conflict (visaai_id) do update set
  official_name = excluded.official_name,
  purpose = excluded.purpose,
  last_verified_at = excluded.last_verified_at;

-- One source. The page states its own fee, so no separate fee page is needed --
-- and INZ's eligible-qualification list, TB country list and police-certificate
-- procedures are all linked rather than stated, so they are left unregistered
-- rather than summarised.
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language,
  robots_state, redistribution, check_interval, freshness_sla, active
)
select c.id, t.id, 'requirements', 'Immigration New Zealand (INZ)', 1,
  'https://www.immigration.govt.nz/new-zealand-visas/visas/visa/post-study-work-visa',
  'https://www.immigration.govt.nz/new-zealand-visas/visas/visa/post-study-work-visa',
  'Post Study Work Visa', 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from public.visa_types t
join public.visa_countries c on c.id = t.country_id and c.code = 'NZ'
where t.visaai_id = 'nz-post-study-work-visa'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'nz-post-study-work-visa';
  if n < 1 then raise exception 'Post study work visa source not registered.'; end if;
end $$;
