-- Promote the UK's Youth Mobility Scheme visa: 20 requirements. The UK reaches
-- 7 published pages; the registry reaches 46, and publishes a YOUTH_MOBILITY
-- route for the first time.
--
-- NATIONALITY CHANGES THE RULE HERE, NOT JUST THE PAPERWORK
--
-- Every conditional requirement in this registry so far has varied the EVIDENCE
-- by circumstance. This route varies eligibility itself, four different ways,
-- and each is stored naming the nationalities it binds:
--
--   * 18-35 for Australia, Canada, New Zealand, South Korea; 18-30 for Andorra,
--     Iceland, Japan, Monaco, San Marino, Uruguay and three British nationality
--     categories.
--   * Hong Kong (SAR passport) and Taiwan must win a BALLOT before they may
--     apply at all -- a gate before the application exists, not a document in
--     it.
--   * Indian nationals use a different scheme.
--   * Andorra, Iceland, San Marino and Uruguay each owe a specific document
--     from their own state, each under six months old -- short enough to expire
--     during a slow application.
--
-- THE AGE RULE IS NOT THE ONE PEOPLE ASSUME
--
-- GOV.UK states it twice, once per band, and the two halves point in opposite
-- directions: 18 or over when the visa STARTS, at or under the ceiling when you
-- APPLY. So you may apply before turning 18, and be over the ceiling when it
-- begins. Turning 31 after issue does not shorten the visa.
--
-- THE SAVINGS RULE IS THE MOST MISSABLE THING ON THE ROUTE
--
-- GBP 2,530 is the easy half. The money must have been available for 28
-- CONSECUTIVE days, and day 28 must fall within 31 days of applying -- a
-- three-day window between satisfying the rule and the evidence going stale.
--
-- AND THE SURCHARGE DWARFS THE FEE
--
-- GBP 340 to apply, and an immigration health surcharge of "usually £776 per
-- year" for the visa's whole length: roughly GBP 1,552 on a two-year visa.
-- Anyone budgeting from the fee alone is out by a factor of five. GOV.UK writes
-- "usually", so the figure is stored as stated rather than as a certainty.
--
-- The self-employment allowance is stored too, because it is a real constraint
-- rather than a formality: rented premises, equipment worth no more than GBP
-- 5,000, no employees.

begin;

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-08-23'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'gb-youth-mobility-scheme' and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified', last_verified_at = '2026-08-23'::timestamptz
where t.visaai_id = 'gb-youth-mobility-scheme'
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
declare pages int; ym int;
begin
  select count(*) into pages from public.visa_publishable_pages where country_code = 'GB';
  if pages <> 7 then raise exception 'Expected 7 publishable UK pages, found %.', pages; end if;

  select count(*) into ym from public.visa_publishable_pages where category = 'youth_mobility';
  if ym < 1 then raise exception 'No youth mobility route publishes.'; end if;
end $$;

commit;
