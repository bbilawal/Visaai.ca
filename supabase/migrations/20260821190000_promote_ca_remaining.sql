-- Promote the five remaining Canadian visa types from draft to active.
--
-- Same separation as every prior promotion: extraction states a claim about a
-- government's rules, this is where someone takes responsibility for it.
--
-- WHAT WAS CHECKED
--
--   * All 94 source_excerpts were machine-verified as contiguous verbatim
--     substrings of the normalized page text. Four failed a first pass — the
--     IRCC fee page interleaves the family-eligibility list between a label and
--     its amount, and the sponsor eligibility list repeats a heading — and were
--     corrected to true contiguous quotes before re-verification.
--   * Every rule validates and evaluates `unknown`, never `false`, on an empty
--     profile. Zero uses of `exists`/`not_exists` anywhere.
--   * Fees are CAD, read from ircc.canada.ca on 2026-08-21: study permit
--     150.00, work permit 155.00, eTA 7.00, spouse/partner 1,260.00 combined,
--     Express Entry 1,590.00 combined, biometrics 85.00 per person.
--
-- THREE JUDGEMENTS KEPT AS EXTRACTED, because each is a refusal to guess
--
--   * No biometrics fee on Express Entry. The fee page scopes that charge to
--     "a visitor visa, study permit or work permit" — a sentence that does not
--     cover a permanent-residence application. Left out rather than assumed.
--   * Express Entry conditions carry no rules. It is three programs (CEC, FSW,
--     FST) with different thresholds, and VisaAI has no fact for which stream
--     an applicant is pursuing. A rule would have hidden the criteria that
--     actually apply to them.
--   * Sponsor-side conditions carry no rules. IRCC writes them about the
--     SPONSOR; VisaAI's facts describe the applicant, who in this program is
--     the sponsored person. The two are different people and the rule engine
--     has no way to say so.
--
-- ca-work-permit is the thinnest of the five (3 conditions) and that is a
-- registry gap, not an extraction failure: none of its four registered sources
-- states eligibility criteria — they are a section index, a link hub, the
-- IMM 1295 form page and the fee list. Recorded as a follow-up rather than
-- padded out from an unregistered page.

begin;

update public.visa_requirements r
set status = 'active',
    last_verified_at = '2026-08-21'::timestamptz
from public.visa_types t
join public.visa_countries c on c.id = t.country_id
where t.id = r.visa_type_id
  and c.code = 'CA'
  and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified',
    last_verified_at = '2026-08-21'::timestamptz
from public.visa_countries c
where c.id = t.country_id
  and c.code = 'CA'
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
