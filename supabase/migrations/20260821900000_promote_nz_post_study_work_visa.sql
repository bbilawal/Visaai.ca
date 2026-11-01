-- Promote New Zealand's post study work visa: 20 requirements.
-- NZ reaches 4 pages; the registry reaches 36.
--
-- THE DEADLINE IS THE TRAP
--
-- "Apply within 3 months of your student visa expiring" is the rule most people
-- carry, and it is wrong for two groups. Doctoral graduates get 6 months.
-- Someone who finished an eligible qualification and moved straight into a
-- higher-level one lasting under 30 weeks gets 12 months, measured from the
-- FIRST qualification's student visa. INZ states it checks its own records for
-- timeliness, so this is settled on facts an applicant cannot re-argue.
--
-- ELIGIBILITY IS TWO ALTERNATIVE ROUTES
--
-- A degree at level 7 or higher, OR a non-degree qualification at level 7 or
-- lower that appears on INZ's published list. They are not equivalent: only the
-- second requires the job to relate to what you studied, and INZ writes that
-- restriction into the visa conditions. Recorded as parallel routes with
-- officially_required = false, the same shape as nl-orientation-year -- listing
-- them as joint conditions would imply an applicant needs both.
--
-- A RULE THAT IS NOT YET IN FORCE, KEPT AS SUCH
--
-- From 16 November 2026 eligibility extends to graduate-diploma-plus-bachelor's
-- applicants. Extraction ran 2026-08-22. Dropping it would hide a change that
-- decides whether someone should wait before applying; recording it as current
-- eligibility would tell people today that they qualify when they do not. It is
-- officially_required = false with the date in the label, so it renders under
-- "Also stated by the authority" rather than among the conditions.
--
-- OTHER THINGS EASY TO GET WRONG:
--   * This visa can be held ONCE. Unlike the Dutch orientation year, there is
--     no second grant on a later qualification.
--   * The police-certificate trigger counts time on EARLIER visas toward the
--     24-month threshold, not just time on this one.
--   * NZD 5,000 is flat across 1, 2 and 3 year applications -- a longer visa
--     does not require more money.
--   * Passport validity runs 3 months past your planned DEPARTURE, not arrival.
--   * Not completing the qualification named on your student visa can sink the
--     application even if you completed a different one.

begin;

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-08-22'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'nz-post-study-work-visa' and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified', last_verified_at = '2026-08-22'::timestamptz
where t.visaai_id = 'nz-post-study-work-visa'
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
