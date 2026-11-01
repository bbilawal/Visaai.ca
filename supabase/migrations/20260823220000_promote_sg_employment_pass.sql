-- Promote Singapore's Employment Pass: 21 requirements.
-- Singapore reaches 1 published page; the registry reaches 49.
--
-- THE APPLICANT IS THE EMPLOYER
--
-- Every MOM work pass is applied for by the hiring company, and MOM says so as
-- a pass fact: "an employer or appointed employment agent needs to apply on
-- behalf of the candidate". A candidate reading this checklist cannot satisfy
-- the ACRA business profile, the MyCareersFuture advertisement, four of the six
-- COMPASS criteria or either fee. Canada's Super Visa put SOME requirements on
-- somebody else; Singapore makes that the normal case, and the page has to say
-- so or it reads as a to-do list the reader cannot action.
--
-- A GATE, THEN A SCORE -- AND THE GATE IS NOT NEGOTIABLE
--
-- Stage 1 is the EP Qualifying Salary. Stage 2 is the 40-point COMPASS. MOM
-- states in TWO separate sections that failing stage 1 ends the application
-- "regardless of the points they would have scored", which is the single most
-- common misreading of a points system and is therefore stored as its own
-- requirement rather than left as a footnote on the salary row.
--
-- TWO SALARY REGIMES, BOTH LIVE
--
--   * Now: $5,600 at age 23 or below, rising with age to $10,700 at 45 and
--     above. Financial services $6,200 to $11,800.
--   * New applications from 1 Jan 2027, and renewals of passes expiring from
--     1 Jan 2028: $6,000 to $11,500, financial services $6,600 to $12,700.
--
-- Both are stored because a candidate applying in late 2026 for a role that
-- will need renewing is deciding against the higher column, not the current
-- one. This is the second time the registry holds both sides of a threshold --
-- Finland's specialist route holds the two sides of one salary test -- and the
-- first time the two sides are separated by a DATE rather than by a page.
--
-- WHAT THIS ROUTE DOES NOT CLAIM
--
-- The 92-cell salary table by single year of age is not reproduced, and neither
-- are the six COMPASS points tables. Four of the six criteria score the
-- EMPLOYER's workforce profile through MOM's own Workforce Insights tool, which
-- is not readable by us and not computable by the candidate. Storing a points
-- table the reader cannot apply to themselves would look like a calculator and
-- work like a decoration. The pass mark, the exemptions and the fact that most
-- of the score is not the candidate's to move are what is stored.
--
-- FRESHNESS: MOM'S EDIT STAMP, NOT A BUILD TIMESTAMP
--
-- No dateModified in the head -- "unknown", by the rule Germany set. What MOM
-- publishes instead is a per-page edit stamp in the body beside "there are
-- updates on this page": 2026-04-28-08:45:48 on eligibility, 2026-05-18-15:45:18
-- on documents required. Distinct per page and three weeks apart, so an editing
-- record rather than a republish. The eligibility page also carries a schedule
-- that binds from 1 Jan 2027, which a stale page cannot.

begin;

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-08-23'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'sg-employment-pass' and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified', last_verified_at = '2026-08-23'::timestamptz
where t.visaai_id = 'sg-employment-pass'
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

do $$
declare pages int; n int;
begin
  select count(*) into pages from public.visa_publishable_pages where country_code = 'SG';
  if pages <> 1 then raise exception 'Expected 1 publishable Singaporean page, found %.', pages; end if;

  select count(*) into n from public.visa_requirements r
  join public.visa_types t on t.id = r.visa_type_id
  where t.visaai_id = 'sg-employment-pass' and r.status = 'active';
  if n <> 21 then raise exception 'Expected 21 active EP requirements, found %.', n; end if;
end $$;

commit;
