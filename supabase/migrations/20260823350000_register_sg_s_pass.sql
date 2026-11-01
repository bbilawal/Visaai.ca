-- Register Singapore's S Pass -- the same shape as the Employment Pass and a
-- materially harder pass to hold, which is only visible with both registered.
--
-- THREE SALARY REGIMES LIVE AT ONCE
--
-- The Employment Pass publishes two columns. The S Pass publishes THREE, and
-- every one of them binds somebody today:
--
--   * renewals of passes expiring 1 Sep 2025 - 31 Aug 2026: $3,150 rising to
--     $4,650 at age 45+
--   * new applications from 1 Sep 2025, and renewals expiring from 1 Sep 2026:
--     $3,300 rising to $4,800
--   * new applications from 1 Jan 2027, and renewals expiring from 1 Jan 2028:
--     $3,600 rising to $5,100
--
-- Financial services runs its own three columns, $3,650 / $3,800 / $4,000 at
-- the bottom, and all three converge on $5,650 at 45 and above -- so the
-- increases fall entirely on younger candidates in that sector.
--
-- WHAT THE S PASS COSTS THAT THE EMPLOYMENT PASS DOES NOT
--
-- The Employment Pass key facts say "no foreign worker levy or quota required".
-- The S Pass says "yes. employers are subject to a quota and levy for s pass
-- employees", and adds two duties the EP does not carry: the employer MUST
-- provide medical insurance, and must buy a Primary Care Plan for workers in
-- dormitories of 7 or more or in CMP sectors before the pass can be issued.
--
-- A lower salary bar, a higher cost to the employer, and a cap on how many can
-- be hired. Which is the point: the S Pass is rationed and the EP is not.
--
-- AND ONE LIMIT THE EP DOES NOT HAVE
--
-- "the duration granted is limited by your passport validity. the pass can only
-- be valid up to 1 month before your passport expiry date." A candidate with 14
-- months of passport left gets 13 months of pass, whatever they were approved
-- for.
--
-- A PROBABILITY, PUBLISHED
--
-- "if the sat shows that the candidate is eligible, there is around a 90% chance
-- that the candidate will get a pass." That is an authority publishing its own
-- approval rate for a pre-check, which is rare enough to store verbatim. It is
-- stored as MOM's statement about its tool, not as a VisaAI prediction.
--
-- QUALIFICATIONS ARE OPTIONAL HERE
--
-- "declaring qualifications is optional ." The Employment Pass awards COMPASS
-- points for them; the S Pass does not require them at all, and shifts the
-- authenticity duty onto the employer if they are declared anyway.

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'SG'),
  'sg-s-pass', 'skilled_worker',
  'S Pass',
  's-pass',
  'Work in Singapore as a foreign associate professional or technician with a job offer, under an employer quota and levy.',
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
  c.id, t.id, v.role, 'Ministry of Manpower (MOM)', 1,
  v.url, v.url, v.title, 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from (values
  ('requirements',
   'https://www.mom.gov.sg/passes-and-permits/s-pass/eligibility',
   'Eligibility for S Pass'),
  ('eligibility',
   'https://www.mom.gov.sg/passes-and-permits/s-pass/key-facts',
   'Key facts on S Pass'),
  ('documents',
   'https://www.mom.gov.sg/passes-and-permits/s-pass/documents-required',
   'Documents required for S Pass'),
  ('application',
   'https://www.mom.gov.sg/passes-and-permits/s-pass/apply-for-a-pass',
   'Apply for an S Pass')
) as v(role, url, title)
join public.visa_types t on t.visaai_id = 'sg-s-pass'
join public.visa_countries c on c.id = t.country_id and c.code = 'SG'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'sg-s-pass' and s.active;
  if n <> 4 then raise exception 'Expected 4 active MOM sources, found %.', n; end if;
end $$;
