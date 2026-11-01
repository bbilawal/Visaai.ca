-- Promote the Netherlands orientation year permit: 15 requirements. NL has 4 pages.
--
-- ELIGIBILITY HERE IS ALTERNATIVES, NOT A CHECKLIST
--
-- IND writes "one of these situations applies to you" and then lists four
-- routes: a Dutch degree, an Erasmus Mundus master's, scientific research in
-- the Netherlands, or a foreign degree from a top-ranked institution.
--
-- Every other visa type in this registry lists conditions that must ALL hold.
-- Recording these four the same way would tell a graduate they need a Dutch
-- degree AND an Erasmus Mundus master's AND research experience AND a top-200
-- foreign degree — a requirement almost nobody could meet, on a permit designed
-- to be broadly available.
--
-- So the four `route_*` entries are officially_required = false individually,
-- and `one_qualifying_situation` carries the actual obligation. The extraction
-- file records this in a `structure_note` so the next person does not "fix" it.
--
-- THE RANKING TEST IS A LIVE EXTERNAL CRITERION
--
-- The foreign-degree route requires the institution to be in the top 200 of at
-- least TWO of three named publishers — Times Higher Education, QS,
-- ShanghaiRanking — assessed on the graduation date. Rankings change annually
-- and IND does not publish a list, so the criterion is recorded and the tables
-- deliberately are not.
--
-- `payment_timing` is a two-sided window that is easy to miss: not before one
-- week after the appointment, not later than three weeks after it.
--
-- `second_orientation_year_possible` is recorded because people assume this
-- permit is once-only. It is not, provided the new qualification post-dates the
-- previous orientation year.

begin;

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-08-22'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'nl-orientation-year' and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified', last_verified_at = '2026-08-22'::timestamptz
where t.visaai_id = 'nl-orientation-year'
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
