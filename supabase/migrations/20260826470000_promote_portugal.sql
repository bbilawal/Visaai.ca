-- Portugal goes live: 16 routes, 116 requirements, from AIMA.
--
-- WHY THIS ONE IS DIFFERENT FROM THE OTHER UNBLOCKINGS. Australia, the United
-- States, France, Japan and Thailand were each mis-filed because a probe asked
-- the wrong host or read an index as a leaf. Portugal was mis-filed because of
-- a bug in OUR fetcher: aima.gov.pt sends exactly one certificate and omits the
-- intermediate, so the chain could not be built and curl reported error 60.
-- Browsers hide this by chasing the leaf's AIA extension, which is why it
-- looked fine to a human and dead to production — and why "works in my browser,
-- dies on the VPS" read as an IP block. Recording it beside the MFA portal's
-- genuine egress block hid a bug we could fix behind one we cannot.
--
-- vistos.mne.gov.pt still resets our connection after ClientHello from the
-- production address, identically for every request shape, and answers 200 from
-- a second egress. It is a decision about our address. It stays unregistered.
--
-- SO PORTUGAL IS HALF A DESTINATION, DELIBERATELY. AIMA decides residence
-- permits; the MFA issues visas. Most routes below require a residence visa
-- whose conditions we cannot publish, and each says so. Two routes do not — the
-- StartUP Visa and the ARI — and those are complete.
--
-- Every assertion below guards a clause whose loss would NOT look like a loss.
--
--   ARI EXCLUDES REAL ESTATE, DIRECTLY AND INDIRECTLY. The regime is known
--   worldwide as the golden visa and the property route is what made it famous.
--   AIMA removes it in one line that a reader scanning the amounts will skim
--   past. Publishing the five qualifying routes without the exclusion would be
--   the single most consequential omission available on this destination.
--
--   THE ARI AMOUNTS ARE THREE DIFFERENT NUMBERS AND THE JOB COUNTS ARE FOUR.
--   EUR 500,000 for research, for a qualifying fund, and for a company plus
--   five permanent jobs; EUR 250,000 for arts and heritage; ten jobs on their
--   own, reduced to eight in a low-density territory. Collapsing any pair
--   invents a threshold nobody set.
--
--   LEGAL ENTRY IS PRESUMED AFTER TWELVE MONTHS OF CONTRIBUTIONS. Art. 88.º
--   n.º 6 is the whole regularisation route for people already in Portugal
--   without a visa, and it is a presumption rather than an alternative proof.
--
--   THE JOB-SEEKER VISA IS 120 DAYS AND CARRIES ITS OWN APPOINTMENT, and its
--   holder may work BEFORE the permit exists. Both halves are unusual and both
--   decide what someone does in their first four months.
--
--   PORTUGAL'S BLUE CARD IS 1.5x, DROPPING TO 1.2x, WITH AN 18-MONTH MOBILITY
--   PERIOD. This registry now holds four member states' Blue Card figures and
--   they disagree — France requires twelve months of prior residence where
--   Portugal requires eighteen. Crossing them produces a confidently wrong
--   number that verifies against nothing.
--
--   THE HIGHLY QUALIFIED SALARY FIGURES CARRY THEIR OWN REFERENCE YEARS, and
--   AIMA states them: 2023 for the average salary, 2024 for the IAS. The euro
--   amounts are already stale on their face and must never render without the
--   years attached.
--
--   THE TECH VISA'S TERMO DE RESPONSABILIDADE REPLACES FOUR PROOFS. Means of
--   subsistence, tax regularity, social security regularity and absence of
--   criminal record all move to the certified company. Losing that clause
--   sends an applicant to assemble a file the programme exists to spare them.
--
--   PERMANENT RESIDENCE COUNTS CONVICTIONS CUMULATIVELY, OVER FIVE YEARS, AND
--   COUNTS SUSPENDED SENTENCES. Three traps in one sentence.
--
--   THE CAMOES SCHOLARSHIP WAIVES FOUR DOCUMENTS and the approved-institution
--   waiver removes two more. A student who qualifies and does not know it will
--   chase paperwork nobody wants.

update public.visa_requirements r
   set status = 'active', last_verified_at = '2026-08-24'::timestamptz
  from public.visa_types t
  join public.visa_countries c on c.id = t.country_id
 where t.id = r.visa_type_id and c.code = 'PT' and r.status = 'draft';

update public.visa_types t
   set data_quality = 'verified', last_verified_at = '2026-08-24'::timestamptz
  from public.visa_countries c
 where c.id = t.country_id and c.code = 'PT'
   and exists (select 1 from public.visa_requirements r
                where r.visa_type_id = t.id and r.status = 'active');

update public.visa_countries
   set support_state = 'supported', fee_currency = 'EUR',
       data_quality = 'verified', last_verified_at = '2026-08-24'::timestamptz
 where code = 'PT';

do $$
declare
  n_active integer; n_draft integer; n_nover integer; n_display integer;
  n_types integer; n_empty integer; n_ari integer; n_presume integer;
  n_jobseek integer; n_termo integer; n_camoes integer; n_perm integer;
  bc_mult text; bc_mob text; hq_year text;
begin
  select count(*) into n_active from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'PT' and r.status = 'active';
  if n_active <> 116 then raise exception 'Expected 116 active Portuguese requirements, found %', n_active; end if;

  select count(*) into n_draft from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'PT' and r.status = 'draft';
  if n_draft <> 0 then raise exception '% Portuguese requirement(s) left in draft', n_draft; end if;

  select count(*) into n_types from public.visa_types t
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'PT' and t.lifecycle_state = 'active';
  if n_types <> 16 then raise exception 'Expected 16 Portuguese routes, found %', n_types; end if;

  -- NO REGISTERED ROUTE MAY BE LEFT EMPTY. This is the condition that left six
  -- US routes registered and unpublishable for the life of the registry.
  select count(*) into n_empty
    from public.visa_types t join public.visa_countries c on c.id = t.country_id
   where c.code = 'PT' and t.lifecycle_state = 'active'
     and not exists (select 1 from public.visa_requirements r
                      where r.visa_type_id = t.id and r.status = 'active');
  if n_empty <> 0 then raise exception '% Portuguese route(s) registered with no requirements', n_empty; end if;

  select count(*) into n_nover from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'PT' and r.source_version_id is null;
  if n_nover <> 0 then raise exception '% Portuguese requirement(s) have no source version', n_nover; end if;

  select count(*) into n_display from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'PT' and r.status = 'active' and r.source_excerpt_display is null;
  if n_display <> 0 then raise exception '% active Portuguese requirement(s) cannot quote their authority', n_display; end if;

  -- ARI: THE REAL ESTATE EXCLUSION AND THE FIVE ROUTES.
  select count(*) into n_ari from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'pt-autorizacao-residencia-investimento'
     and r.requirement_code in ('investment_may_not_be_real_estate','route_ten_jobs','route_research_500k',
       'route_arts_heritage_250k','route_collective_investment_500k','route_company_500k_plus_jobs',
       'low_density_reduces_jobs_to_eight','five_year_commitment_declared_on_honour');
  if n_ari <> 8 then
    raise exception 'The ARI exclusion or one of its qualifying routes is missing: % of 8', n_ari;
  end if;
  if (select parameters->>'amount_eur' from public.visa_requirements
       where requirement_code = 'route_arts_heritage_250k') <> '250000'
     or (select parameters->>'amount_eur' from public.visa_requirements
          where requirement_code = 'route_research_500k') <> '500000' then
    raise exception 'The ARI investment thresholds have been flattened or moved';
  end if;

  -- ART. 88.º N.º 6: LEGAL ENTRY IS PRESUMED.
  select count(*) into n_presume from public.visa_requirements r
   where r.requirement_code = 'legal_entry_is_presumed_after_twelve_months'
     and (r.parameters->>'months') = '12';
  if n_presume <> 1 then raise exception 'The twelve-month presumption of legal entry is missing'; end if;

  -- THE JOB-SEEKER VISA: 120 DAYS, AND WORK BEFORE THE PERMIT.
  select count(*) into n_jobseek from public.visa_requirements r
   where r.requirement_code in ('visa_validity_120_days_with_appointment','may_work_before_the_permit_is_granted');
  if n_jobseek <> 2 then
    raise exception 'The job-seeker visa clock or the right to work before the permit is missing: % of 2', n_jobseek;
  end if;

  -- PORTUGAL'S OWN BLUE CARD FIGURES.
  select r.parameters->>'general_multiplier' into bc_mult from public.visa_requirements r
   where r.requirement_code = 'salary_and_contract_thresholds';
  select r.parameters->>'prior_residence_months' into bc_mob from public.visa_requirements r
   where r.requirement_code = 'mobility_after_18_months_in_another_member_state';
  if bc_mult <> '1.5' or bc_mob <> '18' then
    raise exception 'The Portuguese Blue Card multiplier (%) or mobility period (%) is wrong', bc_mult, bc_mob;
  end if;

  -- THE HIGHLY QUALIFIED FIGURES MUST CARRY THEIR STATED REFERENCE YEARS.
  select r.parameters->>'general_stated_for_year' into hq_year from public.visa_requirements r
   where r.requirement_code = 'salary_thresholds_with_stated_reference_years';
  if hq_year <> '2023' then
    raise exception 'The highly qualified salary figures have lost their stated reference year (got %)', hq_year;
  end if;

  -- THE TECH VISA RELIEF.
  select count(*) into n_termo from public.visa_requirements r
   where r.requirement_code = 'termo_replaces_four_proofs' and r.officially_required = false;
  if n_termo <> 1 then
    raise exception 'The Tech Visa termo de responsabilidade relief is missing or misclassified';
  end if;

  -- THE STUDENT WAIVERS.
  select count(*) into n_camoes from public.visa_requirements r
   where r.requirement_code in ('camoes_scholarship_waives_four_documents','approved_institution_waives_subsistence_and_tuition');
  if n_camoes <> 2 then raise exception 'A student documentary waiver is missing: % of 2', n_camoes; end if;

  -- PERMANENT RESIDENCE: FIVE YEARS, CUMULATIVE, SUSPENDED SENTENCES COUNT.
  select count(*) into n_perm from public.visa_requirements r
   where r.requirement_code = 'criminal_condition_five_year_cumulative'
     and r.source_excerpt like '%isolada ou cumulativamente%'
     and r.source_excerpt like '%a respetiva execução tenha sido suspensa%';
  if n_perm <> 1 then
    raise exception 'The permanent residence criminal condition has lost its cumulative or suspended-sentence limb';
  end if;

  -- The MFA visa portal must never be registered.
  if exists (select 1 from public.visa_sources s join public.visa_countries c on c.id = s.country_id
              where c.code = 'PT' and s.source_url like '%vistos.mne.gov.pt%') then
    raise exception 'vistos.mne.gov.pt drops our source address and must not be registered';
  end if;

  raise notice 'Portugal live: % requirements active across % routes', n_active, n_types;
end $$;
