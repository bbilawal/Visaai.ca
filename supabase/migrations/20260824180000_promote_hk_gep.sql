-- Promote Hong Kong's General Employment Policy: 19 requirements.
-- Hong Kong reaches 1 published page; the registry reaches 59.
--
-- THE AUTHORITY DISCLAIMS ITS OWN CHECKLIST, AND IT RENDERS FIRST
--
-- "the director of immigration reserves absolute discretion to refuse any
-- application even if the application meets all eligibility criteria."
--
-- Stated twice on the page. No other authority in this registry says it that
-- plainly. Every requirement here is necessary and the Department says outright
-- that together they are not sufficient -- so that sentence is stored as a
-- requirement at display_order 10, ahead of the criteria it qualifies. A
-- checklist implying sufficiency would be contradicting the page it cites.
--
-- THE BOUND EARNED ITS KEEP IMMEDIATELY
--
-- `GEP.html` is one URL carrying TWO flows: the entry application and the
-- extension of stay, each with its own eligibility criteria, supporting
-- documents, processing time and fee section. "processing time" occurs four
-- times on the page.
--
-- `verify-extraction-bounds.ts` reports that 1 of the 19 excerpts ALSO appears
-- verbatim outside the bound. That excerpt is correct only because the bound
-- says which block it came from; an unbounded extraction would have verified
-- clean and attributed a first-application rule to a renewal, or the reverse.
-- This is the Norway lesson repeating on a different continent.
--
-- A JOB OFFER IS NOT ENOUGH
--
-- Three of the five criteria are about the EMPLOYER and the labour market
-- rather than the candidate: the vacancy must be genuine, the role must be one
-- "that cannot be readily taken up by the local work force", and the whole
-- remuneration package -- income, accommodation, medical and fringe benefits --
-- must match Hong Kong market level. None of the three can be settled in
-- advance by either party.
--
-- DEPENDANTS: RECOGNITION, AND ITS LIMITS
--
-- Hong Kong admits the other party to a same-sex or opposite-sex civil
-- partnership or civil union recognised where it was entered into, and defines
-- what it will accept in four structural features -- while excluding de facto
-- spouses, cohabiting partners and fiance(e)s by name. Both halves are stored,
-- because a route that recorded only the recognition would mislead exactly the
-- people it appears to help.
--
-- And those dependants "are not prohibited from taking up employment or studies
-- in the hksar" -- a third distinct answer to "can a spouse work?" alongside
-- Singapore's (needs an employer-lodged work pass; getting one cancels the
-- dependency) and Malaysia's (permitted on the same pass by endorsement).
--
-- WHO IS EXCLUDED IS PART OF THE ROUTE
--
-- Mainland Chinese residents are outside the GEP entirely and routed to ASMTP.
-- A PRC passport does not admit its holder to Hong Kong. That is why HK is a
-- destination in its own right rather than a row under CN.

begin;

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-08-24'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'hk-general-employment-policy' and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified', last_verified_at = '2026-08-24'::timestamptz
where t.visaai_id = 'hk-general-employment-policy'
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

-- The discretion disclaimer is the one requirement whose POSITION carries
-- meaning: it qualifies everything after it. Assert it exists and renders
-- before every eligibility criterion, or the page reads as a promise.
do $$
declare pages int; disc int; first_crit int;
begin
  select count(*) into pages from public.visa_publishable_pages where country_code = 'HK';
  if pages <> 1 then raise exception 'Expected 1 publishable Hong Kong page, found %.', pages; end if;

  select display_order into disc from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'hk-general-employment-policy' and r.requirement_code = 'discretion_reserved';

  select min(display_order) into first_crit from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'hk-general-employment-policy'
     and r.requirement_code in ('no_security_objection', 'good_education_background',
                                'genuine_job_vacancy', 'offer_relevant_and_not_locally_available',
                                'market_rate_remuneration');

  if disc is null then raise exception 'The discretion disclaimer is missing.'; end if;
  if first_crit is null or disc >= first_crit then
    raise exception 'The discretion disclaimer (%) must precede the eligibility criteria (first at %).',
      disc, first_crit;
  end if;
end $$;

commit;
