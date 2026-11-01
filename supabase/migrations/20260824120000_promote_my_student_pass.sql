-- Promote Malaysia's Student Pass: 22 requirements.
-- Malaysia reaches 1 published page; the registry reaches 57.
--
-- THE ORDERING IS THE REQUIREMENT
--
-- Malaysia's student route passes through two other bodies before the
-- Immigration Department sees it, and each step gates the next:
--
--   apply from OUTSIDE Malaysia
--     -> EMGS academic screening + Approval to Study letter
--       -> eVAL approval (travel document and security checks)
--         -> single-entry visa via the official eVisa portal, if needed
--           -> enter Malaysia
--             -> post-arrival medical within 7 DAYS
--               -> the INSTITUTION submits for endorsement
--
-- An applicant who goes to Immigration first has not started early. They have
-- started in the wrong place, and the page states the sequence rather than
-- leaving it to be inferred.
--
-- ONE PASS, THREE DIFFERENT SETS OF RIGHTS
--
-- Where you study decides what the pass lets you do, not just what paperwork it
-- needs:
--
--   * Master's or PhD at a university or IPTS -> may bring dependants, may work
--     20 hours a week part-time.
--   * Bachelor's at a university or IPTS      -> no dependants, may work.
--   * Language / training / accredited centre -> no dependants, no work.
--
-- Both bars are stored as separate requirements because they are independent:
-- a centre student is excluded by category even at master's level.
--
-- AND THE eVISA HAS A GEOGRAPHIC HOLE
--
-- "evisa applications can be made worldwide, except from malaysia, israel, and
-- north korea." Compounded with "applicants must be outside malaysia at the time
-- of application submission", a student already in Malaysia has no route in
-- from where they are standing.
--
-- WHY MALAYSIA'S EMPLOYMENT PASS IS ABSENT
--
-- Not an oversight. `imi.gov.my` serves an identical 820-line navigation menu on
-- every page, and the Employment Pass page is 3 unique lines inside it -- the
-- character count and every requirement marker come from the menu. The
-- Department devolves the decision to the Expatriate Committee and sector
-- regulators without publishing their criteria. There is nothing there to
-- extract, and `probe-authority.ts` now says so before anyone spends a night
-- finding out.

begin;

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-08-24'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'my-student-pass' and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified', last_verified_at = '2026-08-24'::timestamptz
where t.visaai_id = 'my-student-pass'
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

-- The sequence is the value of this route. Assert the steps render in the order
-- the authority states them: applying from outside comes first, the medical
-- comes after the visa, and the institution's endorsement comes last.
do $$
declare pages int; outside int; visa int; medical int; endorse int;
begin
  select count(*) into pages from public.visa_publishable_pages where country_code = 'MY';
  if pages <> 1 then raise exception 'Expected 1 publishable Malaysian page, found %.', pages; end if;

  select display_order into outside from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'my-student-pass' and r.requirement_code = 'apply_from_outside_malaysia';
  select display_order into visa from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'my-student-pass' and r.requirement_code = 'eval_approval_then_visa';
  select display_order into medical from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'my-student-pass' and r.requirement_code = 'post_arrival_medical_7_days';
  select display_order into endorse from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'my-student-pass' and r.requirement_code = 'institution_submits_for_endorsement';

  if outside is null or visa is null or medical is null or endorse is null then
    raise exception 'A step of the sequence is missing (%, %, %, %).', outside, visa, medical, endorse;
  end if;
  if not (outside < visa and visa < medical and medical < endorse) then
    raise exception 'The steps are out of order: outside=%, visa=%, medical=%, endorse=%.',
      outside, visa, medical, endorse;
  end if;
end $$;

commit;
