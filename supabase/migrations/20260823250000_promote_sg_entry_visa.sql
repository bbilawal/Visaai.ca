-- Promote Singapore's entry visa: 20 requirements.
-- Singapore reaches 2 published pages; the registry reaches 50.
--
-- THE FINDING THIS ROUTE EXISTS TO CARRY
--
-- ICA publishes ONE entry visa across 33 per-nationality detail pages, and the
-- pages are not one template. 19 nationalities must submit a completed Form
-- V39A letter of introduction from a Singapore citizen or PR aged 21 or over
-- with a Singpass account. The other 14 are told only that additional documents
-- "may be required on a case-by-case basis". Same visa, same S$30 fee, same
-- three-working-day processing -- and one group needs a Singaporean sponsor
-- before it can apply.
--
-- Two pages was the sample that nearly settled it the wrong way: India and
-- Russia differ ONLY in which passport classes are exempt, which reads as
-- "one template, cosmetic differences". Fetching all 33 showed two distinct
-- substantive bodies, and the difference between them is the most consequential
-- requirement Singapore imposes on a visitor.
--
-- IT IS ONE VISA TYPE, NOT TWO
--
-- ICA does not publish it as two, so the registry does not invent the
-- distinction. It is stored as two requirements -- one per group -- each naming
-- its nationality list in `parameters`, so a reader is told which one binds them
-- rather than shown a merged checklist that is wrong for everybody.
--
-- THE LIMITATION IS NAMED AND ANSWERED
--
-- Three sources are registered, so the daily monitor watches 2 of 33 detail
-- pages. `scripts/visa-registry/sg-entry-visa-groups.mjs` re-derives the
-- grouping from all 33 and exits non-zero if the membership moves or a third
-- variant appears. Run 2026-08-23: 19 and 14, exactly as recorded. North
-- Korea's page is excluded and said to be excluded -- its slug carries an
-- HTML-escaped apostrophe and a guessed URL is not a source.
--
-- WHAT ICA SAYS THAT APPLICANTS ROUTINELY ASSUME AWAY
--
--   * "possession of a valid visa does not guarantee entry into singapore."
--   * The period of stay is decided at the checkpoint, not by the visa.
--   * "sg arrival card is not a visa ."
--
-- All three are stored as requirements rather than left as page furniture,
-- because each one is a belief a visitor acts on.

begin;

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-08-23'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'sg-entry-visa' and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified', last_verified_at = '2026-08-23'::timestamptz
where t.visaai_id = 'sg-entry-visa'
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

-- The nationality lists are the whole point of this route. Assert they survived
-- the insert rather than trusting the generator: a requirement that lost its
-- parameters would render as an unqualified rule binding everyone.
do $$
declare pages int; a int; b int;
begin
  select count(*) into pages from public.visa_publishable_pages where country_code = 'SG';
  if pages <> 2 then raise exception 'Expected 2 publishable Singaporean pages, found %.', pages; end if;

  select jsonb_array_length(parameters -> 'applies_to_travel_documents_issued_by')
    into a from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'sg-entry-visa' and r.requirement_code = 'loi_required_group';
  if a is distinct from 19 then raise exception 'LOI-required group holds % nationalities, expected 19.', a; end if;

  select jsonb_array_length(parameters -> 'applies_to_travel_documents_issued_by')
    into b from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'sg-entry-visa' and r.requirement_code = 'loi_case_by_case_group';
  if b is distinct from 14 then raise exception 'Case-by-case group holds % nationalities, expected 14.', b; end if;
end $$;

commit;
