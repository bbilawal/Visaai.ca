-- Promote Norway family immigration (cohabitant route): 11 requirements.
-- Norway reaches 5 pages; the registry reaches 38.
--
-- WHY THIS IS NOT A COPY OF THE SPOUSE ROUTE
--
-- Same url, different block, genuinely different rules:
--
--   * An 18-year floor the spouse route never states, sitting ON TOP of the
--     24-year rule. Both are in UDI's own list; the redundancy is UDI's.
--   * The core test is ALTERNATIVES. UDI writes "one of the following two
--     requirements": two years living together, OR a child together. The spouse
--     route lists conditions that must all hold. Recording these as joint
--     conditions would tell an unmarried couple with a newborn that they also
--     need two years of cohabitation behind them.
--   * The two alternatives are not equally strict — Basis 1 requires only that
--     neither be married to someone ELSE; Basis 2 requires both to be unmarried
--     or divorced outright.
--   * Cohabitation completed in Norway counts only if BOTH had legal residence
--     at the time.
--   * The fee sits under "requirements for the applicant" here, but under
--     "requirements for both" in the spouse block.
--   * No marriage-validity, marriage-recognition, forced-marriage or
--     circumvention-marriage conditions exist on this route at all.
--
-- THE BOUND IS DOING REAL WORK, AND THE TOOL SAYS SO
--
-- verify-extraction-bounds.ts reports that 4 of this route's 9 page-sourced
-- excerpts also appear verbatim OUTSIDE its bound, and 5 of the spouse route's
-- 9 do. Excerpt verification passes all of those from the wrong block, because
-- the text is identical — provenance proves a quote is on the page, never that
-- it is about the right subject. Pointing this file at the spouse bound fails 5
-- requirements, including both cohabitation alternatives.
--
-- The bound anchors on "both of you must be over the age of 18." because the
-- word "cohabitant" occurs 8 times; the checker rejects a non-unique start
-- anchor, which is what produced the better anchor.

begin;

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-08-22'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'no-family-cohabitant' and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified', last_verified_at = '2026-08-22'::timestamptz
where t.visaai_id = 'no-family-cohabitant'
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
