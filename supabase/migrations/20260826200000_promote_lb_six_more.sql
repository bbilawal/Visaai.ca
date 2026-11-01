-- Promote Lebanon's six new routes. Lebanon reaches 10 live routes.
--
-- Five assertions beyond provenance, each guarding something a merge or a
-- dropped line would get wrong in a way the reader could not detect.
--
--   THE 1.5 BILLION MUST BE THERE. `lb-six-month-bank-statement-residence`
--   exists only because B-34 stopped the tag matcher requiring balanced quotes;
--   before that, item 23 — the minimum balance that is the entire financial
--   basis of the route — never reached the normalised text. If it ever goes
--   missing again the route publishes a required-documents list that omits the
--   money, which is exactly the state this migration exists to prevent.
--
--   THE DOMESTIC-WORKER FEE IS BY GENDER. LBP 18,000,000 for women and
--   24,000,000 for men, six million apart, on the authority's own list. One
--   surviving alone misprices half the applicants.
--
--   THE ARTIST FEES ARE BY VENUE CLASS. 15,000,000 for class B and 30,000,000
--   for class A, per artist PER MONTH. They are exactly double each other,
--   which is the easiest pair in this registry to merge by accident.
--
--   THE CLERGY VISA IS NOT CONVERTIBLE. The page says those visas are
--   assimilated to touristic visas that cannot become residency and the holder
--   must leave at expiry. Losing that sentence tells somebody they can stay.
--
--   THE EXCLUDED NATIONALITIES SURVIVE WHOLE. Fourteen are named in one
--   sentence. A truncated list is worse than none, because the reader cannot
--   tell it was truncated.

update public.visa_requirements r
   set status = 'active', last_verified_at = '2026-08-26'::timestamptz
  from public.visa_types t
 where t.id = r.visa_type_id
   and t.visaai_id in ('lb-domestic-worker','lb-artist-visa','lb-religious-student-visa',
                       'lb-foreign-expert-at-port','lb-passport-renewal-temporary-residence',
                       'lb-six-month-bank-statement-residence')
   and r.status = 'draft';

update public.visa_types t
   set data_quality = 'verified', last_verified_at = '2026-08-26'::timestamptz
 where t.visaai_id in ('lb-domestic-worker','lb-artist-visa','lb-religious-student-visa',
                       'lb-foreign-expert-at-port','lb-passport-renewal-temporary-residence',
                       'lb-six-month-bank-statement-residence')
   and exists (select 1 from public.visa_requirements r
                where r.visa_type_id = t.id and r.status = 'active');

do $$
declare
  n_active integer; n_bad integer; n_pages integer; n_lb_total integer;
  n_balance integer; n_fem integer; n_male integer;
  n_class_a integer; n_class_b integer; n_clergy integer; n_nat integer;
  n_heading integer; n_bare integer;
begin
  select count(*) into n_active from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id in ('lb-domestic-worker','lb-artist-visa','lb-religious-student-visa',
                         'lb-foreign-expert-at-port','lb-passport-renewal-temporary-residence',
                         'lb-six-month-bank-statement-residence')
     and r.status = 'active';
  if n_active <> 109 then raise exception 'Expected 109 active requirements in this batch, found %', n_active; end if;

  select count(*) into n_bad from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'LB' and r.status = 'active'
     and (r.source_version_id is null or r.source_excerpt is null or r.source_excerpt_display is null);
  if n_bad > 0 then raise exception '% LB requirement(s) lack provenance or a display quotation', n_bad; end if;

  -- B-33's guards, applied to the whole country rather than to this batch.
  select count(*) into n_heading from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'LB' and r.status = 'active'
     and r.source_excerpt like '%:' and length(r.source_excerpt) <= 100
     and r.source_excerpt !~* '(must|need|require|should|may|shall|will|are|is|allowed|permitted|granted|exempt|at least|one of|either|you|holder)';
  if n_heading > 0 then
    raise exception '% LB requirement(s) quote a section HEADING as their evidence', n_heading;
  end if;

  select count(*) into n_bare from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'LB' and r.status = 'active' and r.kind = 'fee'
     and r.source_excerpt ~* '^[0-9 ,.]*l\.?b\.?p\.?[0-9 ,.]*$';
  if n_bare > 0 then
    raise exception '% LB fee(s) quote a BARE AMOUNT with no indication of what it buys', n_bare;
  end if;

  -- The requirement B-34 recovered.
  select count(*) into n_balance from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'lb-six-month-bank-statement-residence' and r.status = 'active'
     and r.requirement_code = 'doc_bank_statement_minimum_balance'
     and r.source_excerpt like '%1.5 billion%';
  if n_balance <> 1 then
    raise exception 'The 1.5 billion minimum balance must be published; found % (B-34 recovered it)', n_balance;
  end if;

  -- Gendered domestic-worker fees, both halves.
  select count(*) into n_fem from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'lb-domestic-worker' and r.status='active'
     and r.requirement_code = 'fee_residence_female' and r.source_excerpt like '%18.000.000%';
  select count(*) into n_male from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'lb-domestic-worker' and r.status='active'
     and r.requirement_code = 'fee_residence_male' and r.source_excerpt like '%24.000.000%';
  if n_fem <> 1 or n_male <> 1 then
    raise exception 'Both gendered residence fees must survive (found % female, % male)', n_fem, n_male;
  end if;

  -- Artist fees by venue class, which are exactly double each other.
  select count(*) into n_class_b from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'lb-artist-visa' and r.status='active'
     and r.requirement_code = 'fee_class_b_venue' and r.source_excerpt like '%15.000.000%';
  select count(*) into n_class_a from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'lb-artist-visa' and r.status='active'
     and r.requirement_code = 'fee_class_a_venue' and r.source_excerpt like '%30.000.000%';
  if n_class_b <> 1 or n_class_a <> 1 then
    raise exception 'Both artist venue-class fees must survive (found % class B, % class A)', n_class_b, n_class_a;
  end if;

  -- The sentence that decides whether a missionary may stay.
  select count(*) into n_clergy from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'lb-religious-student-visa' and r.status='active'
     and r.requirement_code = 'clergy_visa_is_touristic_not_convertible'
     and r.source_excerpt like '%cannot be transformed into residency%';
  if n_clergy <> 1 then
    raise exception 'The non-convertible clergy visa rule must be published intact; found %', n_clergy;
  end if;

  -- The excluded nationalities, whole.
  select count(*) into n_nat from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'lb-religious-student-visa' and r.status='active'
     and r.requirement_code = 'excluded_nationalities'
     and r.source_excerpt like '%pakistan%' and r.source_excerpt like '%iraqi%';
  if n_nat <> 1 then
    raise exception 'The excluded-nationality list must be quoted whole; found %', n_nat;
  end if;

  select count(*) into n_pages from public.visa_publishable_pages where country_code = 'LB';
  if n_pages <> 10 then raise exception 'Lebanon should publish 10 pages, found %', n_pages; end if;

  select count(*) into n_lb_total from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'LB' and r.status = 'active';

  raise notice 'Lebanon LIVE: 10 routes, % requirements total (% new in this batch)', n_lb_total, n_active;
end $$;
