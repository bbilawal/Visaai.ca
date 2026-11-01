-- Promote the UK and US requirement sets from draft to active.
--
-- Separate from extraction for the same reason as the Canada promotion: the
-- extraction migration states a claim about what a government demands of a
-- person; this is where someone takes responsibility for that claim.
--
-- WHAT WAS CHECKED BEFORE WRITING THIS
--
--   * 166 requirements, 0 missing a source_excerpt, 0 missing provenance,
--     0 recommended rows claiming official status. Verified by query, not by
--     reading — the constraint is structural and the count proves it holds.
--   * Every stored rule validates against the rule language, and every
--     conditional gate evaluates `unknown` — never `false` — on an empty
--     profile, so no requirement can vanish from a checklist before the
--     applicant is asked. Verified with scripts/validate-stored-rules.ts.
--   * Fees carry the currency the page itself names. GOV.UK states amounts
--     plainly (six Standard Visitor tiers, ETA £20, Skilled Worker tiers), so
--     the UK sets carry real money. USCIS does NOT: all four US fee rows say
--     only "visit our fee schedule page", so they carry
--     amount_stated_on_page: false and no number. That asymmetry is a fact
--     about the two governments, not an omission.
--
-- WHAT IS DELIBERATELY NOT PROMOTED
--
-- Australia. All 32 AU sources have zero active versions because
-- immi.homeaffairs.gov.au returns 403 to the source monitor (see below), so
-- there is no source version for an AU requirement to cite. The seven AU
-- extraction files exist and validate; they apply the moment the host is
-- reachable.
--
-- Four US visa types (B-1/B-2, F-1/M-1, business visitor, VWP/ESTA). Every one
-- of their registered sources is on travel.state.gov or ceac.state.gov, both of
-- which are unreachable. No file was written for them rather than a stub that
-- would assert nothing.
--
-- THE WAF SITUATION, RECORDED HERE BECAUSE IT SHAPES COVERAGE
--
-- 56 of 134 sources return HTTP 403 to the monitor. Measured on 2026-08-21
-- against immi.homeaffairs.gov.au:
--
--     no User-Agent                 200
--     curl/8.4.0                    200
--     VisaAI-SourceMonitor/1.0      403
--     SomeGenericBot/1.0            403
--     Googlebot/2.1                 403
--
-- The rule blocks self-identified crawlers from unverified IPs — it blocks
-- Googlebot too. VisaAI is not being singled out.
--
-- Dropping or disguising the User-Agent returns 200. We do not do that. It
-- would be bypassing anti-bot protection, which the execution spec forbids
-- outright (rule 10), and "the workaround is trivial" is not a reason — it is
-- the whole reason the rule exists. The honest paths are an allowlisting
-- request to the authority, or accepting that VisaAI links out to those pages
-- instead of monitoring them. The product already degrades that way by design:
-- a blocked source keeps its metadata and the applicant gets the official link.

begin;

update public.visa_requirements r
set status = 'active',
    last_verified_at = '2026-08-21'::timestamptz
from public.visa_types t
join public.visa_countries c on c.id = t.country_id
where t.id = r.visa_type_id
  and c.code in ('GB', 'US')
  and r.status = 'draft';

-- A country becomes `supported` only once it has BOTH verified sources and
-- reviewed requirements. Both now do.
update public.visa_types t
set data_quality = 'verified',
    last_verified_at = '2026-08-21'::timestamptz
from public.visa_countries c
where c.id = t.country_id
  and c.code in ('GB', 'US')
  and exists (
    select 1 from public.visa_requirements r
    where r.visa_type_id = t.id and r.status = 'active'
  );

update public.visa_countries
set support_state = 'supported',
    data_quality = 'verified',
    last_verified_at = '2026-08-21'::timestamptz
where code in ('GB', 'US');

-- Australia stays in preview: verified sources, no readable ones today.
-- Saying `supported` would claim a level of coverage that does not exist.
update public.visa_countries
set data_quality = 'failing'
where code = 'AU';

-- Guard. The constraints enforce these anyway; failing here names the cause
-- rather than a constraint.
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
      '% active requirement(s) lack provenance or an excerpt, or claim official '
      'status for a recommendation. Promotion aborted.', bad;
  end if;
end $$;

commit;
