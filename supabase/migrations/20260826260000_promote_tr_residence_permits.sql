-- Promote Türkiye's six residence permits. Türkiye reaches 14 live routes.
--
-- Five assertions beyond provenance. Each guards a clause whose loss would not
-- look like a loss — the page would still read as a complete requirement.
--
--   THE STUDENT HALF-COUNT. Eight continuous years qualify for long-term
--   residence, and STUDENT permits count for HALF their duration. Somebody who
--   studied six years and worked two has five counted, not eight. Publish the
--   eight-year rule without the half-count and the page tells them they qualify.
--
--   THE DOMESTIC-VIOLENCE WAIVER. A foreign spouse may move off a family permit
--   after divorce if they held it three years — and the three years are waived
--   entirely where a court establishes domestic violence. Losing the waiver
--   tells the people it protects that they must stay married.
--
--   THE COERCION PROTECTION. A trafficking victim's permit is cancelled if they
--   re-contact the perpetrators OF THEIR OWN VOLITION, and is NOT cancelled
--   where the contact came through coercion, intimidation, violence or threat.
--   The first half alone describes a trap.
--
--   THE SPONSOR INCOME TEST, WHOLE. The family sponsor needs the minimum wage in
--   total AND not less than a third of it per family member. Either figure alone
--   understates what is required.
--
--   THE STUDENT INSURANCE WINDOW. Request general health insurance within three
--   months of admission and nothing else is needed; miss it and private cover
--   becomes mandatory. A deadline that silently converts into a cost.

update public.visa_requirements r
   set status = 'active', last_verified_at = '2026-08-26'::timestamptz
  from public.visa_types t
 where t.id = r.visa_type_id
   and t.visaai_id in ('tr-short-term-residence-permit','tr-family-residence-permit',
                       'tr-student-residence-permit','tr-long-term-residence-permit',
                       'tr-humanitarian-residence-permit','tr-human-trafficking-victim-residence-permit')
   and r.status = 'draft';

update public.visa_types t
   set data_quality = 'verified', last_verified_at = '2026-08-26'::timestamptz
 where t.visaai_id in ('tr-short-term-residence-permit','tr-family-residence-permit',
                       'tr-student-residence-permit','tr-long-term-residence-permit',
                       'tr-humanitarian-residence-permit','tr-human-trafficking-victim-residence-permit')
   and exists (select 1 from public.visa_requirements r
                where r.visa_type_id = t.id and r.status = 'active');

do $$
declare
  n_active integer; n_bad integer; n_pages integer;
  n_half integer; n_dv integer; n_coercion integer; n_income integer; n_insurance integer;
  n_grounds integer; n_heading integer;
begin
  select count(*) into n_active from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id in ('tr-short-term-residence-permit','tr-family-residence-permit',
                         'tr-student-residence-permit','tr-long-term-residence-permit',
                         'tr-humanitarian-residence-permit','tr-human-trafficking-victim-residence-permit')
     and r.status = 'active';
  if n_active <> 115 then raise exception 'Expected 115 active requirements, found %', n_active; end if;

  select count(*) into n_bad from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'TR' and r.status = 'active'
     and (r.source_version_id is null or r.source_excerpt is null or r.source_excerpt_display is null);
  if n_bad > 0 then raise exception '% TR requirement(s) lack provenance or a display quotation', n_bad; end if;

  select count(*) into n_heading from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'TR' and r.status = 'active'
     and r.source_excerpt like '%:' and length(r.source_excerpt) <= 100
     and r.source_excerpt !~* '(must|need|require|should|may|shall|will|are|is|allowed|permitted|granted|exempt|at least|one of|either|you|holder)';
  if n_heading > 0 then
    raise exception '% TR requirement(s) quote a section HEADING as their evidence', n_heading;
  end if;

  -- The half-count that decides eligibility.
  select count(*) into n_half from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'tr-long-term-residence-permit' and r.status='active'
     and r.requirement_code = 'condition_eight_years_student_half'
     and r.source_excerpt like '%half of the duration of student resident permits%';
  if n_half <> 1 then
    raise exception 'The student half-count must be published with the eight-year rule; found %', n_half;
  end if;

  -- The waiver that protects people leaving a violent marriage.
  select count(*) into n_dv from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'tr-family-residence-permit' and r.status='active'
     and r.requirement_code = 'exit_divorce_three_years'
     and r.source_excerpt like '%domestic violence%'
     and r.source_excerpt like '%shall not be sought%';
  if n_dv <> 1 then
    raise exception 'The domestic-violence waiver must survive inside the divorce rule; found %', n_dv;
  end if;

  -- The protection that makes the volition qualifier meaningful.
  select count(*) into n_coercion from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'tr-human-trafficking-victim-residence-permit' and r.status='active'
     and r.requirement_code = 'coercion_protection'
     and r.source_excerpt like '%shall not be cancelled%'
     and r.source_excerpt like '%coercion%';
  if n_coercion <> 1 then
    raise exception 'The coercion protection must be published alongside the cancellation rule; found %', n_coercion;
  end if;

  -- Both halves of the sponsor income test.
  select count(*) into n_income from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'tr-family-residence-permit' and r.status='active'
     and r.requirement_code = 'sponsor_conditions'
     and r.source_excerpt like '%not less than the minimum wage%'
     and r.source_excerpt like '%one third of the minimum wage%';
  if n_income <> 1 then
    raise exception 'The sponsor income test must quote BOTH the total and the per-member figure; found %', n_income;
  end if;

  select count(*) into n_insurance from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'tr-student-residence-permit' and r.status='active'
     and r.requirement_code = 'health_insurance_three_month_window'
     and r.source_excerpt like '%within three months%';
  if n_insurance <> 1 then
    raise exception 'The three-month student insurance window must be published; found %', n_insurance;
  end if;

  -- All fourteen short-term grounds, none quietly merged.
  select count(*) into n_grounds from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'tr-short-term-residence-permit' and r.status='active'
     and r.requirement_code ~ '^ground_[0-9]+_';
  if n_grounds < 14 then
    raise exception 'All 14 short-term grounds must be published separately; found %', n_grounds;
  end if;

  select count(*) into n_pages from public.visa_publishable_pages where country_code = 'TR';
  if n_pages <> 14 then raise exception 'Türkiye should publish 14 pages, found %', n_pages; end if;

  raise notice 'Türkiye LIVE: 14 routes (8 MFA visas + 6 migration residence permits), % new requirements', n_active;
end $$;
