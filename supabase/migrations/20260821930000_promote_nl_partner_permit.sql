-- Promote the Netherlands partner residence permit: 16 requirements.
-- NL reaches 5 pages; the registry reaches 37.
--
-- THE CIVIC INTEGRATION EXAM ABROAD HAS NO COUNTERPART IN THIS REGISTRY
--
-- The partner must pass a language-and-society exam at a Dutch embassy
-- OVERSEAS, and the timing is the trap: before the MVV is applied for, not
-- before travelling. Someone who plans to sit it after arranging the move has
-- already missed it. Exemptions exist and are handled on a separate IND page.
--
-- The tuberculosis test runs the other way and is just as easy to miss: it falls
-- AFTER arrival, so it reads as finished once the permit is granted.
--
-- NO INCOME FIGURE IS RECORDED, ON PURPOSE
--
-- IND states the income requirement and links an income test instead of
-- publishing an amount. A figure recalled or inferred for that field would be
-- the most damaging error available on this page, so the requirement carries
-- IND's wording and no parameters.
--
-- HARD EXCLUSIONS PEOPLE DO NOT EXPECT
--
--   * Seven permit purposes disqualify a sponsor outright -- au pair, working
--     holiday, cultural exchange, work experience, seasonal work, seafaring
--     service, EU-UK trade agreement. Not a hurdle; a bar.
--   * A sponsor under a civic integration obligation must have lived in the
--     Netherlands a year first, unless minor children's interests say otherwise.
--   * The antecedents certificate threshold is age 12, not 18.
--   * The age bar is 21, but drops to 18 for couples already married while both
--     lived outside the Netherlands -- a large group, easily missed.
--
-- THE PAGE RENDERS ITS REQUIREMENTS TWICE
--
-- Block B is a strict subset of block A: 10 lines only in A, zero only in B. No
-- control selects between them, so the split was established from IND's own step
-- 3 wording -- A applies for "the mvv and the residence permit at the same
-- time", B does not mention an MVV. Occurrence counts confirm it: the civic
-- integration exam, the TB test and the MVV application step appear exactly once
-- each; the other thirteen excerpts appear twice. This is the MVV route.

begin;

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-08-22'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'nl-partner-residence-permit' and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified', last_verified_at = '2026-08-22'::timestamptz
where t.visaai_id = 'nl-partner-residence-permit'
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
