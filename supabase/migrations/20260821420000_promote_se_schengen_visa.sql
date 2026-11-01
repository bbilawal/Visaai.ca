-- Promote Sweden's Schengen visa: 12 requirements, the registry's first from a
-- NON-ENGLISH source.
--
-- All 12 excerpts are verbatim Swedish and were verified by
-- scripts/verify-excerpts.ts, which is language-agnostic — it compares strings
-- against the fetched page and neither knows nor needs to know what they mean.
-- That is what makes provenance hold here exactly as it does elsewhere.
--
-- WHAT IS WEAKER, AND IT IS NOT PROVENANCE
--
-- A reviewer who does not read Swedish can still confirm every quote is real.
-- What they cannot independently confirm is that the English `label` and
-- `description` render the Swedish faithfully. Each description therefore
-- states its translation explicitly, so the two sit side by side and a Swedish
-- speaker can check them in one pass. The limitation is recorded in the
-- extraction file's `translation_note` rather than left to be discovered.
--
-- The alternative was worse in both directions: Migrationsverket's English page
-- is 1,771 characters and states no requirement, and the agency's sitemap
-- contains no /English/ URLs at all. Registering it would have produced a page
-- with a "verified" badge and nothing behind it.
--
-- THREE ENTRIES CARRY A QUALIFIER INSIDE THE QUOTE, ON PURPOSE
--
--   * maintenance_700_sek_per_day quotes the exceptions in the same sentence —
--     young children, prepaid board and lodging, staying with relatives. SEK
--     700/day shown alone would overstate what Sweden asks.
--   * travel_medical_insurance is officially_required = FALSE. Migrationsverket
--     writes "rekommenderat" and "bör" — recommended, should — not "måste".
--     Every neighbouring country mandates this cover; copying that assumption
--     across would have made VisaAI stricter than Sweden.
--   * fee_exemptions exists so the EUR 90 fee is never shown as universal.

begin;

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-08-22'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'se-schengen-visa' and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified', last_verified_at = '2026-08-22'::timestamptz
where t.visaai_id = 'se-schengen-visa'
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
