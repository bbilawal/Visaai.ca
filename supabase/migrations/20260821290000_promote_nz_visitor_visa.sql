-- Promote the New Zealand visitor visa: 16 requirements, first new destination
-- since the original four.
--
-- All 16 excerpts verified against the live INZ page by
-- scripts/verify-excerpts.ts — contiguous, no declared elisions needed.
-- Every rule validates and evaluates `unknown`, never `false`, on an empty
-- profile.
--
-- THE ONE RULE, AND ITS ONE INTERPRETATION
--
-- `police_certificates` is gated on `age >= 17 AND stay_duration_days >= 730`.
-- INZ's second condition is written as "your total time in New Zealand will be
-- 24 months or longer"; 730 days is that expressed in the unit the rule engine
-- compares. That conversion is recorded in the requirement's description rather
-- than left implicit, because it is the only place in this file where the
-- stored rule is not a literal transcription of the page.
--
-- It is also rarely reached: this visa's maximum stay is 9 months. It applies
-- when earlier time in New Zealand counts toward the total, which is why the
-- gate is kept rather than dropped as unreachable.
--
-- WHAT IS DELIBERATELY ABSENT
--
-- Five things, all recorded in the extraction file's `not_extracted` list, and
-- each for the same reason: INZ links a separate page rather than stating the
-- content, and none of those pages is a registered source. The visa-waiver and
-- NZeTA country lists are the significant ones — reproducing a country list
-- from memory is exactly what the provenance rule forbids.
--
-- Two entries exist to stop the product overstating things. `chest_xray_or_
-- medical` is officially_required = false because INZ says it MAY ask;
-- `criminal_conviction_may_bar` quotes "we might not give you a visa" so a
-- conviction is never presented as automatically disqualifying.
--
-- The country stays support_state = 'preview'. One visa type with requirements
-- is not a supported destination.

begin;

update public.visa_requirements r
set status = 'active',
    last_verified_at = '2026-08-21'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id
  and t.visaai_id = 'nz-visitor-visa'
  and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified',
    last_verified_at = '2026-08-21'::timestamptz
where t.visaai_id = 'nz-visitor-visa'
  and exists (
    select 1 from public.visa_requirements r
    where r.visa_type_id = t.id and r.status = 'active'
  );

do $$
declare bad int;
begin
  select count(*) into bad
  from public.visa_requirements
  where status = 'active'
    and (source_version_id is null
         or source_excerpt is null
         or source_excerpt = ''
         or (kind = 'recommended' and officially_required));
  if bad > 0 then
    raise exception
      '% active requirement(s) lack provenance or an excerpt, or claim '
      'official status for a recommendation. Promotion aborted.', bad;
  end if;
end $$;

commit;
