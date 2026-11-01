-- Thailand goes live: 3 routes, 34 requirements, from Thai-language pages the
-- department last updated between 2022 and 2024.
--
-- THE DECISION THIS PROMOTION RESTS ON. consular.mfa.go.th publishes the same
-- subject twice: an English "Thai visa information" tree dated 2017, and Thai
-- pages dated 2022-11-30 and 2024-05-24. The English tree is readable, clean
-- and superseded — its catalogue lists eight visa types and omits the LTR
-- visa, the SMART visa and the e-Visa system, all of which Thailand now
-- operates and all of which thaievisa.go.th's own sitemap names.
--
-- That is the Germany condition: reachable is not current. We take the pages
-- that are true over the pages that are convenient, and Sweden already
-- established that a non-English authority is admissible with English labels
-- marked as translations.
--
-- Every assertion below guards a clause whose loss would NOT look like a loss.
--
--   VISA VALIDITY AND LENGTH OF STAY ARE DIFFERENT NUMBERS, and the department
--   prints them in the same block. A tourist visa lives 3 or 6 months and buys
--   60 days PER ENTRY. A non-immigrant visa lives 3 or 12 months and buys 90
--   days per entry. Transit lives 3 months and buys 30. Collapsing the pair on
--   any route tells someone they may stay months longer than they may.
--
--   THE FUNDS FIGURE IS NOT AN APPLICATION DOCUMENT. The page's own footnote
--   defines it as money or exchangeable instruments the traveller must be
--   CARRYING on entry. Rendering it among the documents turns a border
--   requirement into a paperwork item nobody will have at the border.
--
--   THE TRANSIT FIGURES ARE HALF THE TOURIST FIGURES — THB 10,000 against
--   20,000, and 20,000 against 40,000 — and the two pages are otherwise nearly
--   identical in shape. This is exactly the pair most likely to be carried
--   across wrongly.
--
--   THE TRANSIT VISA IS NOT ONLY FOR TRANSIT. It covers sports participation
--   (S) and vehicle crew (C) as well as transit (TS), and each of the three
--   needs different evidence. Someone flying in to compete in a sporting event
--   will never find their route if the name is taken literally.
--
--   THE WORK LETTER COMES FROM THE MINISTRY OF LABOUR, NOT THE CONSULATE. A
--   non-immigrant (B) application must already carry the Department of
--   Employment's approval. The ordering is the requirement, and applying to
--   the consulate first is not a slower route, it is not a route.
--
--   RETIREMENT (O) IS AGE 50 AND AN UNDERTAKING NOT TO WORK. Three conditions
--   in one line, and the third continues for the whole stay.
--
--   EXTENSION AND CHANGE OF VISA TYPE BELONG TO AN AUTHORITY WE CANNOT READ.
--   The department states that both are applied for at the Immigration Bureau
--   and are at the officer's discretion. Losing that clause would leave a
--   reader believing the visa page they are on governs their stay.

update public.visa_requirements r
   set status = 'active', last_verified_at = '2026-08-24'::timestamptz
  from public.visa_types t
  join public.visa_countries c on c.id = t.country_id
 where t.id = r.visa_type_id and c.code = 'TH' and r.status = 'draft';

update public.visa_types t
   set data_quality = 'verified', last_verified_at = '2026-08-24'::timestamptz
  from public.visa_countries c
 where c.id = t.country_id and c.code = 'TH'
   and exists (select 1 from public.visa_requirements r
                where r.visa_type_id = t.id and r.status = 'active');

update public.visa_countries
   set support_state = 'supported', fee_currency = 'THB',
       data_quality = 'verified', last_verified_at = '2026-08-24'::timestamptz
 where code = 'TH';

do $$
declare
  n_active integer; n_draft integer; n_nover integer; n_display integer;
  n_types integer; n_pairs integer; n_funds integer; n_purposes integer;
  tourist_funds text; transit_funds text;
begin
  select count(*) into n_active from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'TH' and r.status = 'active';
  if n_active <> 34 then raise exception 'Expected 34 active Thai requirements, found %', n_active; end if;

  select count(*) into n_draft from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'TH' and r.status = 'draft';
  if n_draft <> 0 then raise exception '% Thai requirement(s) left in draft', n_draft; end if;

  select count(*) into n_types from public.visa_types t
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'TH' and t.lifecycle_state = 'active';
  if n_types <> 3 then raise exception 'Expected 3 Thai routes, found %', n_types; end if;

  select count(*) into n_nover from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'TH' and r.source_version_id is null;
  if n_nover <> 0 then raise exception '% Thai requirement(s) have no source version', n_nover; end if;

  select count(*) into n_display from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'TH' and r.status = 'active' and r.source_excerpt_display is null;
  if n_display <> 0 then raise exception '% active Thai requirement(s) cannot quote their authority', n_display; end if;

  -- VALIDITY AND STAY MUST BOTH SURVIVE, ON ALL THREE ROUTES.
  select count(*) into n_pairs from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'TH'
     and (r.requirement_code like 'visa_validity%' or r.requirement_code like 'stay_per_entry%');
  if n_pairs <> 6 then
    raise exception 'Each Thai route must publish BOTH visa validity and length of stay: % of 6 rows', n_pairs;
  end if;

  -- THE TRANSIT FUNDS ARE HALF THE TOURIST FUNDS. Flattening them is the most
  -- available mistake on this destination.
  select r.parameters->>'per_person_thb' into tourist_funds
    from public.visa_requirements r join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'th-tourist-visa' and r.requirement_code = 'funds_carried';
  select r.parameters->>'per_person_thb' into transit_funds
    from public.visa_requirements r join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'th-transit-visa' and r.requirement_code = 'funds_carried';
  if tourist_funds <> '20000' or transit_funds <> '10000' then
    raise exception 'Thai funds-carried figures are wrong or flattened: tourist=%, transit=%', tourist_funds, transit_funds;
  end if;

  -- THE FUNDS FIGURE IS A CONDITION, NEVER A DOCUMENT.
  select count(*) into n_funds from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'TH' and r.requirement_code = 'funds_carried' and r.kind <> 'condition';
  if n_funds <> 0 then
    raise exception 'funds_carried must be a condition, not a document — it is money carried at the border';
  end if;

  -- THE TRANSIT VISA'S THREE PURPOSES AND THEIR THREE EVIDENCE ROWS.
  select count(*) into n_purposes from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'th-transit-visa'
     and r.requirement_code in ('three_qualifying_purposes','ts_third_country_visa','s_sports_invitation','c_crew_certificate');
  if n_purposes <> 4 then
    raise exception 'The transit visa must publish all three purposes and their distinct evidence: % of 4', n_purposes;
  end if;

  -- THE MINISTRY OF LABOUR PRECONDITION AND THE RETIREMENT AGE.
  if not exists (select 1 from public.visa_requirements r
                  where r.requirement_code = 'work_b_requires_labour_ministry_letter') then
    raise exception 'The Ministry of Labour precondition on non-immigrant (B) is missing';
  end if;
  if (select parameters->>'minimum_age' from public.visa_requirements
       where requirement_code = 'retirement_o_requires_age_50_and_no_work') <> '50' then
    raise exception 'The retirement (O) minimum age has moved off 50';
  end if;

  -- THE IMMIGRATION BUREAU CLAUSE.
  if not exists (select 1 from public.visa_requirements r
                  where r.requirement_code = 'extension_is_immigration_bureaus_discretion') then
    raise exception 'The clause routing extensions to the Immigration Bureau is missing';
  end if;

  -- The refusing and superseded hosts must never be registered.
  if exists (select 1 from public.visa_sources s join public.visa_countries c on c.id = s.country_id
              where c.code = 'TH' and (s.source_url like '%immigration.go.th%'
                                       or s.source_url like '%cate-739%'
                                       or s.source_url like '%thaievisa.go.th%')) then
    raise exception 'A refusing, superseded or text-free Thai host has been registered';
  end if;

  raise notice 'Thailand live: % requirements active across % routes', n_active, n_types;
end $$;
