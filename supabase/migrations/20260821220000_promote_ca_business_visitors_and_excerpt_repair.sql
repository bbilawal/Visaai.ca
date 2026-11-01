-- Promote ca-business-visitors, and re-approve the nine visitor-visa
-- requirements the new excerpt verifier demoted.
--
-- TWO DIFFERENT THINGS ARE BEING APPROVED HERE
--
-- 1. ca-business-visitors: 25 requirements, newly extracted. This was the one
--    Canadian visa type the coverage matrix reported as FAILED, because it had
--    no registered source at all. Both of its sources were found by reading
--    IRCC's own links rather than by constructing a plausible URL, registered in
--    20260821200000, and synced before extraction.
--
-- 2. ca-visitor-visa: 9 requirements whose EVIDENCE changed, not whose claims
--    did. See below. The demotion was automatic and correct; this re-approves
--    them after each new quote was checked against the live page.
--
-- WHAT THE VERIFIER FOUND, AND WHY IT MATTERED
--
-- scripts/verify-excerpts.ts was written because nothing had ever checked that
-- a source_excerpt actually appears on the page it cites. The generator refuses
-- to emit a requirement WITHOUT an excerpt, but never checked the excerpt was
-- real. "Verified verbatim" had been a sentence in a commit message.
--
-- Run against the existing files, it passed 121 excerpts and failed 9 - all in
-- ca-visitor-visa, the earliest extraction, all already live on the public page.
-- Three distinct ways a quote had been assembled rather than copied:
--
--   * Block joins punctuated into sentences. IRCC's page lists "you must:" and
--     then bullets. The excerpt read "you must: be in good health", skipping the
--     bullet in between and presenting the result as continuous prose.
--   * Accessibility text silently dropped. The real page says "use of a
--     representative (imm 5476) (opens in a new tab) (if using an authorized
--     representative)". The excerpt removed the middle clause.
--   * A literal "..." inside a quote, eliding the "what's this?" expander that
--     IRCC renders between a fee's label and its amount.
--
-- Every one of the nine CLAIMS was correct - good health is required, the fee is
-- CAD 100.00. Only the quotes were manufactured. That is the more dangerous
-- failure, not the lesser one: a fabricated quote looks like evidence, so a
-- reviewer approves it without re-opening the page. All nine now match the live
-- text exactly, and the lost lead-in context moved into `description`, which is
-- where VisaAI's own words belong.
--
-- ca-business-visitors carries NO fee and NO form, deliberately. IRCC charges
-- nothing for business visitor status itself; the cost arises from the visitor
-- visa or eTA the person may separately need, and both are their own visa types
-- in this registry. Adding a fee here would bill them twice on screen.

begin;

update public.visa_requirements r
set status = 'active',
    last_verified_at = '2026-08-21'::timestamptz
from public.visa_types t
join public.visa_countries c on c.id = t.country_id
where t.id = r.visa_type_id
  and c.code = 'CA'
  and r.status = 'draft'
  and t.visaai_id in (
    'ca-business-visitors',
    'ca-visitor-visa-temporary-resident-visa'
  );

update public.visa_types t
set data_quality = 'verified',
    last_verified_at = '2026-08-21'::timestamptz
where t.visaai_id = 'ca-business-visitors'
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
