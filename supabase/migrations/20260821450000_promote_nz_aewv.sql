-- Promote New Zealand's Accredited Employer Work Visa: 18 requirements.
--
-- Depth, not breadth. Every destination added this round carries one visa type
-- against Canada's seven, so a "supported" badge was outrunning the coverage
-- behind it. This is the first correction to that.
--
-- TWO ENTRIES THAT EXIST BECAUSE PEOPLE GET CAUGHT BY THEM
--
--   * `visa_tied_to_employer` — the AEWV binds the holder to the employer who
--     offered the job. Changing employer, job or location requires a variation.
--     Someone who does not know that can breach their visa by taking a better
--     offer.
--   * `no_payment_for_job_offer` — INZ declines an application where money was
--     offered or promised for the job offer, and pairs it with a warning that
--     such scams are common in India and South Asia. Recorded because the
--     consequence is refusal, not advice.
--
-- FIVE THINGS ABSENT, ALL FOR THE SAME REASON
--
-- ANZSCO/NOL skill levels, the median wage the job must meet, employer
-- accreditation, the job check process, and the occupational-registration list
-- are each on a separate INZ page that is not a registered source. The wage
-- figure is the one worth naming: it is the single number an applicant most
-- wants, and recalling it would be a fabricated threshold on a page that does
-- not state it.
--
-- Two excerpts preserve INZ's own text exactly where it is imperfect — a
-- doubled verb in the English-language condition, and a sentence truncated
-- where INZ's own prose runs into a link. An excerpt is a quote, not a
-- correction; tidying either would break the verification that proves it real.

begin;

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-08-22'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id
  and t.visaai_id = 'nz-accredited-employer-work-visa'
  and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified', last_verified_at = '2026-08-22'::timestamptz
where t.visaai_id = 'nz-accredited-employer-work-visa'
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

commit;
