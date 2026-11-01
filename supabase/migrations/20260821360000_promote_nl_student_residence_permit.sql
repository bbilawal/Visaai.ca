-- Promote the Netherlands student residence permit: 17 requirements.
--
-- All 17 excerpts verified verbatim against the live IND page. No rules — every
-- condition on this permit applies to every applicant for it.
--
-- THE STRUCTURAL ODDITY WORTH SURFACING
--
-- The applicant does not lodge this application. `institution_applies_on_your_
-- behalf` quotes IND: the educational institution submits it and applies for
-- the mvv and the residence permit at the same time. Every other visa type in
-- this registry is applicant-lodged, so a checklist that silently assumed the
-- usual shape would tell a student to do something they cannot do.
--
-- The same fact explains two absences that would otherwise look like gaps:
-- IND does not publish the document list (the recognised sponsor holds it) and
-- the fee is paid through the institution.
--
-- THREE FIGURES DELIBERATELY NOT RECORDED
--
-- The general requirements, the income requirement amount, and the fee
-- exceptions are each on a separate IND page that is not a registered source.
-- The income figure is the one that matters: every other destination here
-- publishes a maintenance threshold, and recalling a euro amount for the
-- Netherlands because the shape of the data expects one is precisely the
-- fabrication the provenance rule exists to prevent. Only the headline
-- € 254,00 application fee is recorded, because that IS stated on this page.
--
-- `study_progress_50_percent` is a condition of KEEPING the permit rather than
-- obtaining it, and is marked as such in its description — the institution
-- assesses it and must report insufficient progress to the IND.

begin;

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-08-21'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id
  and t.visaai_id = 'nl-student-residence-permit-higher-education'
  and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified', last_verified_at = '2026-08-21'::timestamptz
where t.visaai_id = 'nl-student-residence-permit-higher-education'
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
