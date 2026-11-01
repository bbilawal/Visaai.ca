-- The United States: six routes that have been registered and empty since the
-- registry began, given readable authorities.
--
-- WHAT WAS WRONG, AND IT WAS NOT THE COUNTRY
--
-- `GLOBAL_COVERAGE_EXCEPTIONS.md` listed six US visa types as blocked, on the
-- evidence of 49 consecutive fetch failures against travel.state.gov. That
-- evidence is real and unchanged: travel.state.gov answers HTTP 403 on
-- robots.txt from the VPS, so we cannot read what it permits and we stop.
--
-- But travel.state.gov is the CONSULAR ISSUANCE desk. It is not the only
-- authority the United States has, and it was never the only one that
-- publishes these requirements. Re-probed 2026-08-24 from the VPS
-- (docs/visa-data/BLOCKED_COUNTRY_REPROBE.md):
--
--   www.uscis.gov              robots 200, path allowed, 19,918 sitemap pages
--   www.cbp.gov                robots 200, path allowed, 14,000 sitemap pages
--   studyinthestates.dhs.gov   robots 200, path allowed
--
-- All three are Department of Homeland Security components, all serve
-- server-rendered English, and every page registered below was read off those
-- hosts' own sitemaps rather than constructed. Three US routes were already
-- published from exactly these hosts; the other six were left on State
-- Department URLs alone and therefore had nowhere to read from.
--
-- WHAT THIS DOES AND DOES NOT CHANGE
--
-- The existing travel.state.gov sources are NOT removed and NOT deactivated.
-- They remain the correct citation for visa issuance and interview procedure,
-- and if that host ever answers again the monitor should resume reading it.
-- What changes is that each route now also has a source we can actually read.
--
-- `authority_rank` records the split rather than hiding it:
--   rank 1  DHS components — who may be admitted, and in what status
--   rank 2  Department of State — how the visa itself is issued abroad
-- A reader told the wrong agency writes to the wrong office.

insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language,
  robots_state, redistribution, check_interval, freshness_sla, active
)
select
  c.id, t.id, v.role, v.authority, 1,
  v.url, v.url, v.title, 'en',
  -- robots.txt is HTTP 200 on all three hosts and the path is ALLOWED for our
  -- User-Agent. Recorded as the measurement it is, not as an assumption.
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from (values
  -- us-business-visitor -------------------------------------------------
  ('us-business-visitor', 'requirements',
   'U.S. Citizenship and Immigration Services',
   'https://www.uscis.gov/working-in-the-united-states/temporary-visitors-for-business/b-1-temporary-business-visitor',
   'B-1 Temporary Business Visitor'),
  ('us-business-visitor', 'landing',
   'U.S. Citizenship and Immigration Services',
   'https://www.uscis.gov/working-in-the-united-states/temporary-visitors-for-business',
   'Temporary Visitors for Business'),

  -- us-visitor-visa-b-1-business-b-2-tourism -----------------------------
  ('us-visitor-visa-b-1-business-b-2-tourism', 'requirements',
   'U.S. Citizenship and Immigration Services',
   'https://www.uscis.gov/working-in-the-united-states/temporary-visitors-for-business/b-1-temporary-business-visitor',
   'B-1 Temporary Business Visitor'),
  ('us-visitor-visa-b-1-business-b-2-tourism', 'policy',
   'U.S. Customs and Border Protection',
   'https://www.cbp.gov/travel/international-visitors',
   'International Visitors'),
  ('us-visitor-visa-b-1-business-b-2-tourism', 'application',
   'U.S. Citizenship and Immigration Services',
   'https://www.uscis.gov/visit-the-united-states/extend-your-stay',
   'Extend Your Stay'),

  -- us-student-visa-academic-f-vocational-m -----------------------------
  ('us-student-visa-academic-f-vocational-m', 'requirements',
   'U.S. Citizenship and Immigration Services',
   'https://www.uscis.gov/working-in-the-united-states/students-and-exchange-visitors/students-and-employment',
   'Students and Employment'),
  ('us-student-visa-academic-f-vocational-m', 'application',
   'U.S. Citizenship and Immigration Services',
   'https://www.uscis.gov/working-in-the-united-states/students-and-exchange-visitors/students-and-employment/changing-to-a-nonimmigrant-f-or-m-student-status',
   'Changing to a Nonimmigrant F or M Student Status'),
  ('us-student-visa-academic-f-vocational-m', 'documents',
   'U.S. Immigration and Customs Enforcement — Student and Exchange Visitor Program',
   'https://studyinthestates.dhs.gov/students/prepare/students-and-the-form-i-20',
   'Students and the Form I-20'),
  ('us-student-visa-academic-f-vocational-m', 'eligibility',
   'U.S. Immigration and Customs Enforcement — Student and Exchange Visitor Program',
   'https://studyinthestates.dhs.gov/students/maintaining-status',
   'Maintaining Status'),

  -- us-exchange-visitor --------------------------------------------------
  ('us-exchange-visitor', 'requirements',
   'U.S. Citizenship and Immigration Services',
   'https://www.uscis.gov/working-in-the-united-states/students-and-exchange-visitors/exchange-visitors',
   'Exchange Visitors'),

  -- us-treaty-trader-treaty-investor ------------------------------------
  ('us-treaty-trader-treaty-investor', 'requirements',
   'U.S. Citizenship and Immigration Services',
   'https://www.uscis.gov/working-in-the-united-states/temporary-workers/e-1-treaty-traders',
   'E-1 Treaty Traders'),
  ('us-treaty-trader-treaty-investor', 'requirements',
   'U.S. Citizenship and Immigration Services',
   'https://www.uscis.gov/working-in-the-united-states/temporary-workers/e-2-treaty-investors',
   'E-2 Treaty Investors'),

  -- us-transiting-the-united-states -------------------------------------
  -- NOTE the asymmetry, and it is deliberate. No DHS host publishes a page
  -- about transit as its own subject; the C classification is issued by the
  -- Department of State, whose host refuses us. What DHS does state is that
  -- transit is one of the permitted B-1 activities, and that is registered
  -- here as exactly that much and no more. The route stays thin on purpose
  -- rather than being padded from a page that is about something else.
  ('us-transiting-the-united-states', 'requirements',
   'U.S. Citizenship and Immigration Services',
   'https://www.uscis.gov/working-in-the-united-states/temporary-visitors-for-business/b-1-temporary-business-visitor',
   'B-1 Temporary Business Visitor'),
  ('us-transiting-the-united-states', 'policy',
   'U.S. Customs and Border Protection',
   'https://www.cbp.gov/travel/international-visitors',
   'International Visitors')
) as v(visaai_id, role, authority, url, title)
join public.visa_types t on t.visaai_id = v.visaai_id
join public.visa_countries c on c.id = t.country_id
on conflict do nothing;

-- The State Department sources stay, and stay ranked second. Demoting them
-- records WHY a reader should look at DHS first; deleting them would erase a
-- correct citation because one host stopped answering us.
update public.visa_sources s
   set authority_rank = 2
  from public.visa_countries c
 where s.country_id = c.id
   and c.code = 'US'
   and (s.source_url like 'https://travel.state.gov/%'
        or s.source_url like 'https://ceac.state.gov/%')
   and s.authority_rank is distinct from 2;

do $$
declare
  n_dhs integer; n_state integer; n_empty integer; n_rank1_state integer;
begin
  select count(*) into n_dhs
    from public.visa_sources s join public.visa_countries c on c.id = s.country_id
   where c.code = 'US'
     and (s.source_url like 'https://www.uscis.gov/%'
          or s.source_url like 'https://www.cbp.gov/%'
          or s.source_url like 'https://studyinthestates.dhs.gov/%'
          or s.source_url like 'https://esta.cbp.dhs.gov/%');
  if n_dhs < 14 then
    raise exception 'Expected at least 14 DHS-hosted US sources after this migration, found %', n_dhs;
  end if;

  -- THE POINT OF THE MIGRATION, asserted rather than assumed: no active US
  -- visa type may be left with only State Department sources, because that is
  -- the condition that produced six empty routes in the first place.
  select count(*) into n_empty
    from public.visa_types t
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'US' and t.lifecycle_state = 'active'
     and not exists (
       select 1 from public.visa_sources s
        where s.visa_type_id = t.id
          and (s.source_url like 'https://www.uscis.gov/%'
               or s.source_url like 'https://www.cbp.gov/%'
               or s.source_url like 'https://studyinthestates.dhs.gov/%'
               or s.source_url like 'https://esta.cbp.dhs.gov/%'));
  if n_empty <> 0 then
    raise exception
      '% active US route(s) still have no readable DHS source — that is the '
      'condition this migration exists to end', n_empty;
  end if;

  select count(*) into n_rank1_state
    from public.visa_sources s join public.visa_countries c on c.id = s.country_id
   where c.code = 'US' and s.authority_rank = 1
     and (s.source_url like 'https://travel.state.gov/%' or s.source_url like 'https://ceac.state.gov/%');
  if n_rank1_state <> 0 then
    raise exception 'State Department sources must rank 2 behind DHS; % still rank 1', n_rank1_state;
  end if;

  select count(*) into n_state
    from public.visa_sources s join public.visa_countries c on c.id = s.country_id
   where c.code = 'US' and s.source_url like 'https://travel.state.gov/%';
  raise notice 'US sources: % DHS-hosted, % travel.state.gov retained at rank 2', n_dhs, n_state;
end $$;
