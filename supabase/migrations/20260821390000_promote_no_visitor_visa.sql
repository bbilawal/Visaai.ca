-- Promote Norway's visitor visa: 14 requirements.
--
-- All 14 excerpts verified verbatim. One rule (parental signature, gated on
-- is_minor) and it is a literal transcription.
--
-- TWO THINGS THIS FILE IS CAREFUL ABOUT
--
-- `funds_guideline_amounts` carries NOK 300 / 1,300 / 1,000 per day in
-- `parameters`, but UDI calls them GUIDELINES and says in the same breath that
-- sufficiency "will be assessed individually in each case". They are recorded
-- as guidance, not a threshold, and the surrounding sentence is inside the
-- quote so a reader cannot mistake one for the other. Presenting a guideline as
-- a pass/fail number would make VisaAI stricter than Norway.
--
-- The excerpt preserves UDI's typo, "sufficent". An excerpt is a quote, not a
-- correction — silently fixing it would break the machine verification that
-- proves the quote is real, which is the whole point of storing it.
--
-- WHAT IS NOT RULED, AND WHY
--
-- `schengen_90_180_check` has no rule. VisaAI holds no record of an applicant's
-- prior days in the Schengen area, and gating this on a fact we do not have
-- would hide the check from exactly the person who needs it — someone who has
-- recently travelled. Same reasoning as the Australian recent-travel bar.
--
-- `likelihood_of_return_assessed` is recorded even though it is a decision
-- criterion rather than a document, because UDI states plainly that weak ties
-- normally mean refusal. An applicant who never sees that is being set up.

begin;

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-08-22'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'no-visitor-visa' and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified', last_verified_at = '2026-08-22'::timestamptz
where t.visaai_id = 'no-visitor-visa'
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
