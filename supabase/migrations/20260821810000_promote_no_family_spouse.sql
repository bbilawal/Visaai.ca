-- Promote Norway family immigration (spouse route): 11 requirements.
-- Norway reaches 4 pages, and the registry gains its first family-reunification
-- route outside Canada, the UK and the US.
--
-- THE OBLIGATION IS SPLIT BETWEEN TWO PEOPLE
--
-- Every other visa type here states what ONE person must do. UDI separates
-- "requirements for the applicant" from "requirements for the reference person"
-- -- and the income requirement of NOK 436,957 per year pre-tax falls entirely
-- on the sponsor already living in Norway, who never files the application.
-- Each requirement names whose obligation it is, because a checklist that hands
-- the applicant the sponsor's salary bar is wrong about who owes what.
--
-- The income rule is also three tests at once, not one: the year ahead, the
-- year already past, and the whole processing period.
--
-- EXTRACTION IS BOUNDED, AND THE BOUND IS NOW MACHINE-CHECKED
--
-- The requirements page is 21,998 characters concatenating 8+ family categories
-- -- spouse, cohabitant, fiance(e), children, parents -- each with its own
-- "requirements for both / applicant / reference person" block and the same
-- income figure repeated verbatim. Everything here was read only from the
-- spouse block.
--
-- This matters more than it sounds: 5 of the 9 excerpts taken from that page
-- appear VERBATIM in a sibling category as well. `verify-excerpts.ts` passes
-- them identically whether they came from the right block or the wrong one, so
-- excerpt verification alone cannot catch a cohabitant rule filed under
-- spouses. `scripts/verify-extraction-bounds.ts` was written for this file and
-- checks the bound by text anchors -- not character offsets, which slide onto a
-- neighbouring category the moment UDI edits anything earlier on the page.
--
-- WHAT IS DELIBERATELY NOT ENCODED
--
-- The 24-year age requirement can be waived, and UDI decides by weighing which
-- countries the couple's -- and their PARENTS' -- backgrounds are from, against
-- a list it states is "not exhaustive" and "can be changed over time". The
-- exemption is recorded as existing, with UDI's own wording. Its criteria are
-- not encoded as a rule: doing so would turn a caseworker's discretionary
-- judgement about a person's ethnicity into an automated verdict, and would go
-- stale silently. `age_24_exemption_possible` is therefore
-- officially_required = false -- it is a relief from a requirement, not one.

begin;

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-08-22'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'no-family-spouse' and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified', last_verified_at = '2026-08-22'::timestamptz
where t.visaai_id = 'no-family-spouse'
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
