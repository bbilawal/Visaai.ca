-- Promote Canada's Super Visa: 25 requirements. Canada reaches 8 published
-- pages; the registry reaches 45, and publishes a PARENT route for the first
-- time.
--
-- HALF OF THESE BIND SOMEBODY WHO IS NOT THE APPLICANT
--
-- IRCC splits its eligibility page into "host requirements" and "applicant
-- requirements". The host -- the child or grandchild in Canada -- must be a
-- citizen, permanent resident or registered Indian, be 18 or over, meet a
-- published income floor and sign the invitation. An applicant who satisfies
-- every applicant requirement is refused if the host does not qualify, and
-- nothing on the applicant's side can fix that.
--
-- So they are stored as requirements in their own right, labelled HOST. Folding
-- them into the applicant's list would produce items nobody reading it can act
-- on; omitting them would produce a checklist that is complete and still leads
-- to a refusal. This is the first route here where the checklist is not a list
-- of things one person does.
--
-- THE FAMILY-SIZE COUNT IS THE COUNTER-INTUITIVE PART
--
-- The income floor depends on family size, and the count includes people who
-- are not in Canada and may never have been: previously approved super visa
-- holders on a still-applicable invitation, and previously sponsored people
-- whose undertaking is still in effect. Dependent children count regardless of
-- custody arrangements. IRCC publishes four worked examples for exactly this
-- reason, and getting the count wrong moves the host across an income band.
--
-- OTHER THINGS EASY TO GET WRONG:
--   * Proof of relationship is the HOST'S birth certificate -- the document
--     names the applicant as parent. That is the reverse of what applicants
--     expect to be asked for.
--   * A quote is not insurance. IRCC requires the policy paid in full or on
--     instalments with a deposit, valid for EACH entry, with CAD 100,000
--     emergency cover.
--   * A foreign insurer must be OSFI-authorised AND on OSFI's public list --
--     and OSFI lists no foreign insurer unless it is registered as a Canadian
--     branch or subsidiary. Brokers and claims administrators never appear.
--   * A pending sponsorship application does not block a super visa. Families
--     in the sponsorship queue routinely assume they must choose.
--   * Visa-exempt applicants can hold a super visa and still need a SEPARATE
--     eTA to fly.
--   * Only the host's spouse or common-law partner may co-sign. A sibling
--     cannot.
--   * Option 2 lets the host reach 75% and the applicant cover the rest -- but
--     then the applicant must prove the income CONTINUES while in Canada.
--
-- WHY THIS ROUTE, NOW
--
-- The sweep evidence pass found zero of 166 IRCC form findings named on any
-- page we track, which measures our canada.ca coverage rather than those forms'
-- scope. This adds four pages to it.

begin;

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-08-23'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'ca-super-visa' and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified', last_verified_at = '2026-08-23'::timestamptz
where t.visaai_id = 'ca-super-visa'
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

do $$
declare pages int; roles int; parent int;
begin
  select count(*) into pages from public.visa_publishable_pages where country_code = 'CA';
  if pages <> 8 then raise exception 'Expected 8 publishable Canadian pages, found %.', pages; end if;

  -- All four pages must be carrying requirements. The income table lives on
  -- exactly one of them, so a silent failure to bind `policy` would drop every
  -- figure while the page still rendered and looked complete.
  select count(distinct s.role) into roles
  from public.visa_requirements q
  join public.visa_types t on t.id = q.visa_type_id
  join public.visa_source_versions v on v.id = q.source_version_id
  join public.visa_sources s on s.id = v.source_id
  where t.visaai_id = 'ca-super-visa' and q.status = 'active';
  if roles <> 4 then raise exception 'Expected active requirements from all 4 source roles, found %.', roles; end if;

  select count(*) into parent from public.visa_publishable_pages where category = 'parent';
  if parent < 1 then raise exception 'No parent route publishes.'; end if;
end $$;

commit;
