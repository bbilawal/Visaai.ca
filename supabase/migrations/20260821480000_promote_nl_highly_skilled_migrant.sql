-- Promote the Netherlands highly skilled migrant permit: 14 requirements.
--
-- Second Dutch visa type, and the second employer-lodged one — like the student
-- permit, only an IND-recognised sponsor can apply. Two of the three Dutch and
-- New Zealand work/study routes added in this depth pass share that shape,
-- which is worth noticing: a checklist engine that assumes the applicant lodges
-- their own application is wrong for a growing share of the registry.
--
-- THE SALARY THRESHOLD IS ABSENT, AND THAT IS THE POINT
--
-- The highly skilled migrant route is defined by its income requirement, and it
-- is the single number an applicant will look for. IND links a separate income
-- page rather than stating it here, and the amounts change every January.
--
-- Recalling a figure would produce the most plausible-looking fabrication in
-- the whole registry: a euro amount, on a page about salary thresholds, that no
-- source states. `salary_at_market_rate` IS recorded, because IND states that
-- one in full on this page.
--
-- `intra_corporate_transferee_exclusion` is recorded so someone being
-- transferred from a non-EU company is not walked down the wrong route — IND
-- treats that as a different permit with different requirements.
--
-- `big_registration_healthcare` carries no rule. VisaAI has an occupation fact,
-- but nothing that maps to the BIG Act's article 3 and 36a profession lists, and
-- a wrong gate on a healthcare registration requirement would hide it from
-- exactly the doctors and nurses it applies to.
--
-- Note the decision period: 90 days here, against 60 for the student permit.
-- Both quoted from their own pages rather than assumed to match.

begin;

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-08-22'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id
  and t.visaai_id = 'nl-highly-skilled-migrant'
  and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified', last_verified_at = '2026-08-22'::timestamptz
where t.visaai_id = 'nl-highly-skilled-migrant'
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
