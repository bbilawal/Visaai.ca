-- Register the UAE's Green and Blue Residency routes.
--
-- Both were enumerable from the same ICP services index that produced the
-- Golden Residency, so their URLs were READ off the site rather than
-- constructed, and both publish a dateline of 2026-08-20.
--
-- WHY THESE TWO ARE WORTH KEEPING SEPARATE FROM GOLDEN
--
-- They are not tiers of one programme. Green runs five years and turns on
-- employment, freelance permits or investment; Blue runs ten and turns on
-- environmental contribution, including contribution made OUTSIDE the UAE.
-- Golden runs five or ten depending on category. Collapsing them into a
-- "long-term residency" page would lose the only thing an applicant needs:
-- which one they can actually get.
--
-- THE FIGURE COLLISIONS THAT MADE THE LABELS MATTER
--
-- AED 1 million appears twice on the Blue page for different parties: financial
-- support GIVEN by an influencer, and annual revenue ACHIEVED by an investor's
-- project. AED 2 million is the investor capital floor on both Blue and Golden,
-- for differently scoped projects. And Green sets AED 15,000 MONTHLY for skilled
-- workers against AED 360,000 ANNUAL for freelancers — same route, two income
-- tests that are not interchangeable.
--
-- Every requirement is therefore scoped to its category in the label, and the
-- promotion migration asserts that scoping rather than trusting it.

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
)
select
  (select id from public.visa_countries where code = 'AE'),
  v.visaai_id, v.category, v.official_name, v.slug, v.purpose,
  'active', 'unverified', '2026-08-25'::timestamptz
from (values
  ('ae-green-residency', 'work', 'Green Residence', 'green-residency',
   'Five-year renewable UAE residence without a sponsor, for skilled workers, freelancers and self-employed professionals, and investors or business partners.'),
  ('ae-blue-residency', 'permanent_residence', 'Blue Residence', 'blue-residency',
   'Ten-year renewable UAE residence for people making exceptional contributions to environmental protection and sustainability, whether in the UAE or internationally.')
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
  c.id, t.id, 'landing',
  'Federal Authority for Identity, Citizenship, Customs & Port Security (ICP)', 1,
  v.url, v.url, v.title, 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from (values
  ('ae-green-residency', 'https://icp.gov.ae/en/services/uae-green-residency/', 'Green Residence Guide'),
  ('ae-blue-residency',  'https://icp.gov.ae/en/services/uae-blue-residency/',  'Blue Residence Guide')
) as v(visaai_id, url, title)
join public.visa_types t on t.visaai_id = v.visaai_id
join public.visa_countries c on c.id = t.country_id
on conflict do nothing;

do $$
declare n_type integer; n_source integer; n_pages integer;
begin
  select count(*) into n_type from public.visa_types
   where visaai_id in ('ae-green-residency','ae-blue-residency') and lifecycle_state = 'active';
  if n_type <> 2 then raise exception 'Expected 2 active new UAE visa types, found %', n_type; end if;

  select count(*) into n_source from public.visa_sources s
    join public.visa_types t on t.id = s.visa_type_id
   where t.visaai_id in ('ae-green-residency','ae-blue-residency') and s.active;
  if n_source <> 2 then raise exception 'Expected 2 active ICP sources, found %', n_source; end if;

  -- Neither may publish yet: no requirement has been promoted.
  select count(*) into n_pages from public.visa_publishable_pages
   where visaai_id in ('ae-green-residency','ae-blue-residency');
  if n_pages <> 0 then
    raise exception '% page(s) publishable before any requirement was promoted', n_pages;
  end if;

  raise notice 'Green and Blue Residence registered: 2 types, 2 sources, 0 publishable (as expected)';
end $$;
