-- Promote Ireland's Short Stay 'C' visa: 21 requirements.
--
-- All 21 excerpts verified verbatim against the live ISD page. One rule
-- (previous-refusal disclosure, gated on has_prior_refusal) and it is a literal
-- transcription, not an interpretation.
--
-- THE ENTRY WORTH ARGUING ABOUT
--
-- `finances_no_minimum` records that ISD sets NO minimum amount of money, in
-- ISD's own words. That looks like a non-requirement and is the opposite.
--
-- Every other destination in this registry publishes a threshold — Canada, New
-- Zealand's NZD 1,000 a month, the UK's maintenance rules. An extractor working
-- from pattern rather than page would supply a number here, and a reviewer
-- skimming a checklist that showed no figure might "fix" it by carrying one
-- across from a neighbour. Stating the absence explicitly, quoted, is what stops
-- that.
--
-- TWO ENTRIES EXIST TO STOP THE PRODUCT OVERSTATING THINGS
--
--   * `visa_is_not_permission_to_enter` quotes ISD saying an immigration officer
--     may refuse entry even with a valid visa, so an approval is never shown as
--     guaranteed entry.
--   * `medical_or_travel_insurance` is kept as ONE requirement rather than split,
--     because the point is timing: not needed with the application, needed at the
--     port of entry. Filing it as an application document would be wrong;
--     dropping it would leave someone arriving without it.
--
-- Five things are absent and recorded in not_extracted, chiefly the fee amount
-- (ISD links a fees page and notes exemptions, so a single figure would be
-- wrong even if it were on this page) and the three visa-waiver routes, each of
-- which defers to an unregistered page with its own eligibility.

begin;

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-08-21'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id
  and t.visaai_id = 'ie-short-stay-c-visa'
  and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified', last_verified_at = '2026-08-21'::timestamptz
where t.visaai_id = 'ie-short-stay-c-visa'
  and exists (select 1 from public.visa_requirements r
              where r.visa_type_id = t.id and r.status = 'active');

do $$
declare bad int;
begin
  select count(*) into bad from public.visa_requirements
  where status = 'active'
    and (source_version_id is null or source_excerpt is null or source_excerpt = ''
         or (kind = 'recommended' and officially_required));
  if bad > 0 then
    raise exception '% active requirement(s) lack provenance or an excerpt.', bad;
  end if;
end $$;

commit;
