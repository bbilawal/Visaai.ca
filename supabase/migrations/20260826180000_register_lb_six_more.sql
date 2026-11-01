-- Lebanon depth pass: six further routes off the same enumerable index.
-- Lebanon goes 4 -> 10 routes.
--
-- WHY THESE SIX AND NOT MORE
--
-- The index enumerates more still (sponsorship transfer, the escaping-worker
-- complaint, LibanPost renewals, the kafala regularisation, artists in
-- nightclubs, the Syrian and Palestinian arrangements). Every extraction file
-- here names them under `not_extracted`, so the remaining gap stays a known
-- quantity rather than an impression of completeness.
--
-- ONE ROUTE ON THE INDEX IS DELIBERATELY NOT REGISTERED
--
-- `posts/428`, Residence Permits for Iraqi Nationals. Its five served lines
-- refer to "the residency mentioned in item (2) above" and "residency
-- applications mentioned in item (1) above" — and items (1) and (2) are absent
-- from the page in the normalised text AND in the raw HTML. Publishing a
-- cross-reference to a list the reader cannot see is worse than publishing
-- nothing, so nothing is what it gets.
--
-- ONE ROUTE ONLY BECAME EXTRACTABLE BECAUSE OF B-34
--
-- `lb-six-month-bank-statement-residence` reads from `posts/497`, which is
-- built out of malformed `<span  New Roman","serif"">` tags. Until the tag
-- matcher stopped requiring balanced quotes, three numbered items never reached
-- the normalised text at all — including item 23, the LBP 1.5 billion minimum
-- balance that is the entire financial basis of the route. Extracting it a day
-- earlier would have published a required-documents list with the money
-- requirement missing, and nothing in the pipeline could have noticed, because
-- every check compares our text against text we already have.

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
)
select
  (select id from public.visa_countries where code = 'LB'),
  v.visaai_id, v.category, v.official_name, v.slug, v.purpose,
  'active', 'unverified', '2026-08-26'::timestamptz
from (values
  ('lb-domestic-worker', 'temporary_worker', 'Domestic Worker — entry visa, work permit and residence', 'domestic-worker',
   'The full Lebanese domestic-worker pipeline in the order General Security publishes it: a prior Ministry of Labour authorisation, a visa at a General Security bureau, a labour permit, a residence permit and its renewal — with the sponsor''s own financial standing and the published fee ceiling.'),
  ('lb-artist-visa', 'performer', 'Artist Entry Visa and Residency', 'artist-visa',
   'Lebanese entry visas for artists engaged by touristic enterprises: the documents and monthly fees by venue class, the Unified Mutual Fund contract endorsement and 10% levy required before any other step, and the six-month residency available to artists who do not work in nightclubs.'),
  ('lb-religious-student-visa', 'religious', 'Visas and Residency for Students of Religion, Missionaries, Volunteers and Men of Religion', 'religious-student-visa',
   'Lebanese entry visas and residence permits for students of religion at accredited institutions, and for men of religion, missionaries and volunteers hosted by a religious, charitable or university institution — including the nationalities temporarily excluded and the fees for each group.'),
  ('lb-foreign-expert-at-port', 'temporary_worker', 'Entry Visa for Foreign Technical Specialists at Ports', 'foreign-expert-at-port',
   'A one-month non-renewable visa issued at a Lebanese port for foreign technical or administrative experts brought in by an enterprise, applied for through the Bureau of Public Relations; stays beyond a month fall under the first-class worker rules instead.'),
  ('lb-passport-renewal-temporary-residence', 'other', 'Temporary Residence Permit Pending Passport Renewal', 'passport-renewal-temporary-residence',
   'A bridging permit for residents whose passport has expired or is close to expiring while a replacement is being issued by their embassy — a free two-month permit for employment residents, or a renewal on the previous permit without late fees for the other categories.'),
  ('lb-six-month-bank-statement-residence', 'other', 'Six-Month Multiple-Entry Residence Permit Based on a Bank Statement', 'six-month-bank-statement-residence',
   'A six-month multiple-entry Lebanese residence permit granted on the strength of a bank account, requiring a minimum balance of 1.5 billion Lebanese pounds and a notarised undertaking not to work — closed to holders of any work residence permit and to anyone ordered to leave.')) as v(visaai_id, category, official_name, slug, purpose)
on conflict (visaai_id) do update set
  official_name    = excluded.official_name,
  purpose          = excluded.purpose,
  last_verified_at = excluded.last_verified_at;

-- Several routes draw on more than one page, so the role carries the post id.
-- Collapsing them into one `requirements` role would silently drop every source
-- after the first and monitor a fraction of what the route publishes.
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language,
  robots_state, redistribution, check_interval, freshness_sla, active
)
select
  c.id, t.id, 'requirements',
  'General Directorate of General Security (Lebanon)', 1,
  v.url, v.url, v.title, 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from (values
  ('lb-domestic-worker', 'requirements_23', 'https://www.general-security.gov.lb/en/posts/23',
   'The documents required to obtain a domestic worker'),
  ('lb-domestic-worker', 'requirements_171', 'https://www.general-security.gov.lb/en/posts/171',
   'Application for a domestic worker entry visa'),
  ('lb-domestic-worker', 'requirements_168', 'https://www.general-security.gov.lb/en/posts/168',
   'Fees for hiring a domestic worker'),
  ('lb-artist-visa', 'requirements_526', 'https://www.general-security.gov.lb/en/posts/526',
   'Amendment of Required Documents for Obtaining an Artist Visa'),
  ('lb-artist-visa', 'requirements_48', 'https://www.general-security.gov.lb/en/posts/48',
   'Entry visa of an artist to touristic enterprises'),
  ('lb-artist-visa', 'requirements_413', 'https://www.general-security.gov.lb/en/posts/413',
   'Residency of foreign artists'),
  ('lb-religious-student-visa', 'requirements_239', 'https://www.general-security.gov.lb/en/posts/239',
   'Visas or residency permits for students in religions, volunteers, missionaries and men of religion'),
  ('lb-foreign-expert-at-port', 'requirements_65', 'https://www.general-security.gov.lb/en/posts/65',
   'A visa for a foreign expert at a port'),
  ('lb-passport-renewal-temporary-residence', 'requirements_68', 'https://www.general-security.gov.lb/en/posts/68',
   'Temporary Residence Permit for Passport Renewal'),
  ('lb-six-month-bank-statement-residence', 'requirements_497', 'https://www.general-security.gov.lb/en/posts/497',
   'A six-month residence visa (multiple-entry), based on a bank statement')) as v(visaai_id, role, url, title)
join public.visa_types t on t.visaai_id = v.visaai_id
join public.visa_countries c on c.id = t.country_id
on conflict do nothing;

do $$
declare n_type integer; n_src integer; n_total integer;
begin
  select count(*) into n_type from public.visa_types
   where visaai_id in ('lb-domestic-worker','lb-artist-visa','lb-religious-student-visa',
                       'lb-foreign-expert-at-port','lb-passport-renewal-temporary-residence',
                       'lb-six-month-bank-statement-residence')
     and lifecycle_state = 'active';
  if n_type <> 6 then raise exception 'Expected 6 new Lebanese routes, found %', n_type; end if;

  select count(*) into n_src from public.visa_sources s
    join public.visa_types t on t.id = s.visa_type_id
   where t.visaai_id in ('lb-domestic-worker','lb-artist-visa','lb-religious-student-visa',
                         'lb-foreign-expert-at-port','lb-passport-renewal-temporary-residence',
                         'lb-six-month-bank-statement-residence')
     and s.active;
  if n_src <> 10 then
    raise exception 'Expected 10 sources across the 6 routes (three of them multi-page), found %', n_src;
  end if;

  -- Lebanon totals TEN routes. posts/428 is on the index and is not one of
  -- them; if this ever reads 11, somebody has registered the Iraqi-nationals
  -- page whose own cross-references are missing from the page.
  select count(*) into n_total from public.visa_types t
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'LB' and t.lifecycle_state = 'active';
  if n_total <> 10 then
    raise exception 'Lebanon should total 10 routes, found %', n_total;
  end if;

  raise notice 'Lebanon depth: 6 routes registered, 10 sources, awaiting sync';
end $$;
