-- Promote New Zealand's Exchange Student Visa: 16 requirements. NZ has 3 pages.
--
-- THE ENTRY THAT JUSTIFIES THIS VISA TYPE
--
-- `study_abroad_not_eligible` quotes INZ saying study abroad programmes are NOT
-- approved exchange schemes, and naming the fee paying student visa as the
-- route those students should take instead.
--
-- That is routing information rather than a hurdle, and it is the most valuable
-- kind of thing this registry holds: applying on the wrong student visa costs an
-- application fee, weeks of processing, and a refusal on record. A registry that
-- lists only what a visa requires cannot warn someone they are on the wrong page.
--
-- TWO ENTRIES RECORD RIGHTS RATHER THAN DUTIES
--
-- `no_tuition_fees` and `work_rights` are both officially_required = false.
-- Neither is an obligation; the first is the main practical difference from the
-- fee paying student visa, and the second is conditional on age and course
-- length in INZ's own words.
--
-- THREE EXCERPTS PRESERVE BROKEN SENTENCES
--
-- INZ's prose runs into inline links in several places — "an offer of place from
-- an", "accepted into an .", "as you are considered a ." The normalizer keeps
-- what is served and the excerpts keep what the normalizer produced. Tidying
-- them into whole sentences would read better and would break the verification
-- that proves each quote is genuinely on the page.

begin;

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-08-22'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'nz-exchange-student-visa' and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified', last_verified_at = '2026-08-22'::timestamptz
where t.visaai_id = 'nz-exchange-student-visa'
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
