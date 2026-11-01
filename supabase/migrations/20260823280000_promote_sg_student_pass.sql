-- Promote Singapore's Student's Pass: 25 requirements.
-- Singapore reaches 3 published pages; the registry reaches 51.
--
-- THE EDUTRUST RULE IS THE ONE NO PROSPECTUS LEADS WITH
--
-- "peis that are not edutrust-certified cannot offer placements to foreign
-- students ... a student's pass will not be issued to foreigners enrolled in
-- peis that are not edutrust-certified."
--
-- An offer of a place from an uncertified private school is worth nothing to a
-- foreign applicant who does not already hold a Dependant's Pass, Long-Term
-- Visit Pass or Immigration Exemption Order. It is a rule about the SCHOOL,
-- published only by the immigration authority, and it is why the PEI page is
-- registered in its own right rather than treated as a variant of the
-- Institutes of Higher Learning page.
--
-- THE EXEMPTIONS ARE CONTINGENT ON SOMEBODY ELSE'S STATUS
--
-- A Dependant's Pass, Long-Term Visit Pass or Immigration Exemption Order
-- removes the need for a Student's Pass -- until the underlying pass expires or
-- is cancelled mid-course, when the holder must apply and "the prevailing
-- student's pass eligibility criteria will apply". A dependant studying on a
-- parent's status is one job change away from needing their own pass, assessed
-- against whatever the rules say that day.
--
-- AND RELIGIOUS STUDY INVERTS THEM
--
-- For an approved religious school the Dependant's Pass and Long-Term Visit
-- Pass exemptions DO NOT apply -- those holders need a Student's Pass -- while
-- the Immigration Exemption Order still exempts. Same three passes, opposite
-- effect, decided by the subject studied. That is stored as its own requirement
-- because a merged rule would be wrong for two of the three.
--
-- TWO PROCESSING TIMES, QUOTED FROM THEIR OWN PAGES
--
-- One week at an institute of higher learning. One month at a private education
-- institution, two weeks if it is EduTrust-accredited. Four times the
-- difference at worst, on the same pass, so neither is quoted from the other's
-- page and both name the institution type they belong to.
--
-- FOUR INSTITUTION TYPES ARE NOT COVERED, AND SAY SO
--
-- Foreign System Schools, Government/Government-Aided/Independent Schools,
-- Institutes of Technical Education and Kindergartens/Childcare Centres each
-- have their own page, document list and processing time. They are not
-- extracted, and the two registered pages are not claimed to represent them.
--
-- FRESHNESS: NO DATELINE, DATED POLICY INSTEAD
--
-- ICA prints a body dateline on its entry-visa hub but not on these four pages,
-- so freshness reads as UNKNOWN rather than fresh -- the Germany rule. What the
-- pages carry instead is dated policy a stale page could not: digital-only
-- issuance "from 27 february 2023", the vaccination rule "with effect from
-- 1 february 2019", and an IHL list naming Assas International School
-- (Singapore). Corroboration, recorded as corroboration, not as a dateline.

begin;

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-08-23'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'sg-student-pass' and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified', last_verified_at = '2026-08-23'::timestamptz
where t.visaai_id = 'sg-student-pass'
  and exists (select 1 from public.visa_requirements r
              where r.visa_type_id = t.id and r.status = 'active');

do $$
declare bad int;
begin
  select count(*) into bad from public.visa_requirements
  where status = 'active'
    and (source_version_id is null or source_excerpt is null or source_excerpt = ''
         or (kind = 'recommended' and officially_required));
  if bad > 0 then raise exception '% active requirement(s) lack provenance.', bad; end if;
end $$;

-- The two processing-time rules must stay bound to DIFFERENT pages. If a later
-- edit ever pointed both at the same source version, the page would show one
-- institution type's timeline as though it were the other's.
do $$
declare pages int; a uuid; b uuid;
begin
  select count(*) into pages from public.visa_publishable_pages where country_code = 'SG';
  if pages <> 3 then raise exception 'Expected 3 publishable Singaporean pages, found %.', pages; end if;

  select r.source_version_id into a from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'sg-student-pass' and r.requirement_code = 'processing_time_ihl_one_week';
  select r.source_version_id into b from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'sg-student-pass' and r.requirement_code = 'processing_time_pei_one_month';
  if a is null or b is null or a = b then
    raise exception 'The IHL and PEI processing times must cite different pages (% vs %).', a, b;
  end if;
end $$;

commit;
