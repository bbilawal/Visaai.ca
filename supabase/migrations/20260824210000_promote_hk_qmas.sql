-- Promote Hong Kong's Quality Migrant Admission Scheme: 19 requirements.
-- Hong Kong reaches 2 published pages; the registry reaches 60.
--
-- THE POINTS ARE NOT THE DECISION
--
-- QMAS runs FOUR stages, and the points test is the second:
--
--   1. Prerequisites -- age, self-funding, character, degree. Fail one and the
--      application "will not be further processed and will be refused
--      immediately".
--   2. One of two points tests: 12 criteria with a threshold, or 2 criteria.
--   3. A SELECTION EXERCISE, periodic, in which "not all applications meeting
--      both the prerequisites and the passing threshold will necessarily be
--      approved".
--   4. Issuance.
--
-- So the threshold qualifies you for a competition; it does not admit you.
-- Singapore's COMPASS is 40 points and you are through. Here the points get you
-- considered, and a panel chaired by the Secretary for Labour and Welfare
-- weighs Hong Kong's manpower needs across sectors -- factors in no points
-- table and outside the applicant's control.
--
-- Storing the threshold without storing stage 3 would describe a scheme that
-- does not exist, so `passing_threshold_is_not_approval` is its own requirement
-- and the migration asserts it renders before the initial stay length.
--
-- NO JOB OFFER, WHICH IS THE POINT
--
-- "applicants are not required to have secured an offer of local employment."
--
-- The General Employment Policy, promoted an hour ago, requires a confirmed
-- offer, a genuine vacancy AND a role the local workforce cannot readily fill.
-- Same authority, same country, opposite premise -- and neither page mentions
-- the other. Hong Kong runs an employer-sponsored route and a self-sponsored
-- one side by side, and only a registry holding both shows that.
--
-- The practical consequence is stored too: QMAS entrants get 36 months "on time
-- limitation only without other conditions of stay". No employment condition,
-- so no employer to be tied to.
--
-- DISCRETION, BROADER THAN THE GEP'S
--
-- The GEP reserves discretion to refuse an application that meets every
-- criterion. This page also reserves discretion over WHETHER A CRITERION WAS
-- MET, and adds that refusal needs no reason. Both are stored on their own
-- routes, in the authority's own words, because they are different powers.
--
-- BOUNDED, AND THE BOUND EARNED ITS KEEP AGAIN
--
-- Same tabbed structure as the GEP: one URL, entry plus extension of stay.
-- `verify-extraction-bounds.ts` reports 2 of the 19 excerpts also appear
-- verbatim outside the bound -- one more than the GEP. Both are correct only
-- because the bound says which block they came from.

begin;

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-08-24'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'hk-quality-migrant-admission-scheme' and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified', last_verified_at = '2026-08-24'::timestamptz
where t.visaai_id = 'hk-quality-migrant-admission-scheme'
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

-- Two things must hold or this route misleads:
--   * "meeting the threshold is not approval" must render before the stay
--     length, or the page reads as a promise with a duration attached.
--   * Hong Kong's two work routes must stay distinguishable: GEP requires an
--     offer, QMAS does not. If either loses its rule the pair stops making
--     sense.
do $$
declare pages int; caveat int; stay int; gep_offer int; qmas_nooffer int;
begin
  select count(*) into pages from public.visa_publishable_pages where country_code = 'HK';
  if pages <> 2 then raise exception 'Expected 2 publishable Hong Kong pages, found %.', pages; end if;

  select display_order into caveat from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'hk-quality-migrant-admission-scheme'
     and r.requirement_code = 'passing_threshold_is_not_approval';
  select display_order into stay from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'hk-quality-migrant-admission-scheme'
     and r.requirement_code = 'initial_stay_36_months';
  if caveat is null or stay is null or caveat >= stay then
    raise exception 'The selection caveat (%) must precede the stay length (%).', caveat, stay;
  end if;

  select count(*) into gep_offer from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'hk-general-employment-policy'
     and r.requirement_code = 'offer_relevant_and_not_locally_available' and r.status = 'active';
  select count(*) into qmas_nooffer from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'hk-quality-migrant-admission-scheme'
     and r.requirement_code = 'no_job_offer_required' and r.status = 'active';
  if gep_offer <> 1 or qmas_nooffer <> 1 then
    raise exception 'Hong Kong''s two work routes must stay distinguishable (gep offer=%, qmas no-offer=%).',
      gep_offer, qmas_nooffer;
  end if;
end $$;

commit;
