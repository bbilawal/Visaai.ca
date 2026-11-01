-- Promote Ireland's non-EEA family reunification route: 12 requirements.
-- Ireland reaches 5 published pages; the registry reaches 48.
--
-- THE MONEY IS THE ROUTE, AND THE FIGURES ARE THE HIGHEST HERE
--
--   * Category A (Irish citizen) sponsoring a spouse: EUR 75,000 gross
--     CUMULATIVE over the three years before applying, above any State benefits.
--   * Category C (general employment permit): over EUR 30,000 in the previous
--     year -- a single-year test for the same relationship, decided entirely by
--     the sponsor's permission type.
--   * Category B: NO FIGURE IS PUBLISHED. ISD says the status "assumes certain
--     levels of income". Its absence is the fact, and it is stored as one.
--   * Minor children, Category C: EUR 39,780 NET for one child rising to
--     EUR 79,664 net for eight. The binding figure is net; ISD's gross
--     equivalents are labelled indicative, so a job offer quoting gross is not
--     directly comparable.
--   * Dependent adult relatives: EUR 96,929 a year for one, EUR 165,042 for
--     three -- the highest threshold in this registry, applying to every sponsor
--     category alike.
--
-- AND ONE RULE SINKS OTHERWISE-COMFORTABLE HOUSEHOLDS
--
-- "only the income of one sponsor will be considered, so you cannot combine
-- your salary with that of your spouse, partner or any other family member".
-- A couple earning EUR 40,000 each does not meet a EUR 50,200 threshold.
--
-- WHAT THIS ROUTE DOES NOT CLAIM
--
-- The per-category application pages -- spouse, de facto partner, dependent
-- parent, minor child, dependent adult child -- are rendered client-side by
-- irishimmigration.ie and absent from the server-side HTML. Their conditions are
-- not in this registry and the extraction says so.
--
-- Second time today: New Zealand's working-holiday country list is hidden the
-- same way. The pattern is now explicit -- publish the part we can read, link
-- the authority for the rest, and state which is which. A page that looks
-- complete while silently omitting the conditions that decide the case is
-- exactly what this registry exists to prevent.
--
-- FRESHNESS: A REAL DATELINE, NOT A PLATFORM REPUBLISH
--
-- The two pages are stamped 57 minutes apart on 12 June 2026, and the hub
-- repeats the date in its body. Minutes apart is a human editing session;
-- seconds apart across unrelated pages is the GOV.UK-style republish
-- check-source-freshness.ts discounts. This is the first kind.

begin;

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-08-23'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'ie-family-reunification-non-eea' and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified', last_verified_at = '2026-08-23'::timestamptz
where t.visaai_id = 'ie-family-reunification-non-eea'
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
declare pages int; fr int;
begin
  select count(*) into pages from public.visa_publishable_pages where country_code = 'IE';
  if pages <> 5 then raise exception 'Expected 5 publishable Irish pages, found %.', pages; end if;

  select count(*) into fr from public.visa_publishable_pages where category = 'family_reunification';
  if fr < 1 then raise exception 'No family reunification route publishes.'; end if;
end $$;

commit;
