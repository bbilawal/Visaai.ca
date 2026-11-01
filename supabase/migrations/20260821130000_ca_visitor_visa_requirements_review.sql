-- Promote the Canada visitor visa requirements from draft to active.
--
-- THIS MIGRATION IS THE REVIEW STEP, and it is separate from the extraction
-- migration on purpose. Extraction produces a claim about what a government
-- demands of a person; promotion is where someone takes responsibility for that
-- claim being right. Collapsing the two would make "reviewed" mean nothing.
--
-- WHAT WAS CHECKED, per row, before writing this file:
--
--   1. The source_excerpt is verbatim from the page named by its source, read
--      on 2026-08-21 from canada.ca and ircc.canada.ca.
--   2. The label restates the excerpt without adding an obligation the page
--      does not state.
--   3. `kind` matches what the page describes — a condition to satisfy, a
--      document to provide, a form to file, a fee to pay, a step to complete.
--   4. `officially_required` is true only where IRCC states the requirement.
--      The one row where it is false, `travel_history`, sits under IRCC's own
--      heading "recommended documents".
--   5. Every rule validates against the rule language AND evaluates to
--      `unknown` — never `false` — on an empty profile, so no requirement can
--      disappear from a checklist before the applicant has been asked.
--
-- THREE RULES WERE CORRECTED DURING REVIEW rather than promoted as extracted.
-- `biometrics`, `biometrics_fee` and `imm5645` were first written with
-- `op: 'exists'`. That operator answers `false` for a fact nobody supplied, so
-- all three evaluated false for a new applicant — which would have dropped a
-- mandatory biometrics appointment and its fee off the checklist entirely. The
-- biometrics pair is now unconditional with the citizenship condition stated in
-- its description, because IRCC gates it on a country list this extraction did
-- not capture; over-including a labelled step is recoverable, hiding a
-- mandatory one is not.
--
-- WHAT IS NOT COVERED, and is recorded in data/requirements/ca-visitor-visa.json:
--   * the IMM 5484 checklist PDF contents
--   * marine-crew and business-visitor branch documents (the apply page's tabs
--     flatten during normalization, so attributing them would be guesswork)
--   * per-visa-office additional documents
--   * processing times — not stated on any page read
--   * the biometrics country list

begin;

update public.visa_requirements r
set status = 'active',
    last_verified_at = '2026-08-21'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id
  and t.visaai_id = 'ca-visitor-visa-temporary-resident-visa'
  and r.status = 'draft';

-- Canada moves from `preview` to `supported`: it now has verified sources AND
-- reviewed requirements, which is what the word is for. The visa type's
-- verification date is set from the same read.
update public.visa_types
set data_quality = 'verified',
    last_verified_at = '2026-08-21'::timestamptz
where visaai_id = 'ca-visitor-visa-temporary-resident-visa';

update public.visa_countries
set support_state = 'supported',
    data_quality = 'verified',
    last_verified_at = '2026-08-21'::timestamptz
where code = 'CA';

-- Guard: promotion must not leave a requirement without provenance, and must
-- not promote a `recommended` row as officially required. Both are enforced by
-- constraints, but an explicit check here fails with a sentence rather than a
-- constraint name.
do $$
declare bad int;
begin
  select count(*) into bad
  from public.visa_requirements r
  join public.visa_types t on t.id = r.visa_type_id
  where t.visaai_id = 'ca-visitor-visa-temporary-resident-visa'
    and r.status = 'active'
    and (r.source_version_id is null
         or (r.kind = 'recommended' and r.officially_required));
  if bad > 0 then
    raise exception
      '% active requirement(s) either lack provenance or claim official status '
      'for a recommendation. Promotion aborted.', bad;
  end if;
end $$;

commit;
