-- Re-approve two requirements reclassified from `evidence` to `condition`.
--
-- THE DEFECT, WHICH WAS MINE
--
-- `registry-to-framework.ts` puts `evidence` and `recommended` into the
-- applicant's document checklist, and deliberately excludes `condition`, `step`
-- and `fee` — a checklist is things you obtain and upload, and "pay EUR 423" is
-- not one.
--
-- I extracted two Dutch requirements as `evidence` that are not documents at
-- all:
--
--   nl-highly-skilled-migrant   "Your employer holds the list of documents you need"
--   nl-student-residence-permit "The document list comes from your educational institution"
--
-- Both are statements about WHERE the document list lives. Classified as
-- evidence, they rendered as checklist rows. The highly skilled migrant permit
-- was the clearest failure: its entire checklist was that single row — an
-- applicant saw a one-item list, could not action it, and had nothing telling
-- them the real list existed elsewhere. A checklist that looks complete and is
-- empty is worse than no checklist.
--
-- Caught by running the real conversion over the real data rather than by
-- reading the extraction files again, which is how it got past me twice.
--
-- WHAT THIS DOES NOT FIX
--
-- nl-highly-skilled-migrant now yields ZERO applicant documents, which is
-- accurate — IND publishes no applicant-facing list for that route — but a
-- surface that renders zero documents as "nothing to upload" would be its own
-- misreading. The conditions are still there and still say the sponsor holds
-- the list. Making the checklist surface say that in words is a UI change, not
-- a data one, and is deliberately not smuggled in here.

begin;

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-08-22'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id
  and r.status = 'draft'
  and t.visaai_id in (
    'nl-highly-skilled-migrant',
    'nl-student-residence-permit-higher-education'
  );

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
