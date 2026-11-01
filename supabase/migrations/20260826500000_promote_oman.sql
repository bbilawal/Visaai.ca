begin;

-- Oman goes live: 6 routes, 33 requirements — WORK PERMITS, not entry visas.
--
-- THE ASYMMETRY IS THE FINDING. The Royal Oman Police e-Visa portal is willing
-- and unreadable: robots.txt 404, which is conventionally unrestricted, and a
-- 44,892-byte "Know your Visa Type" catalogue normalising to 927 characters
-- because it is rendered by script. Nobody refused us; there is no text. So a
-- non-Omani worker needs BOTH a Ministry of Labour work permit and an ROP
-- visa, and this destination publishes only the first. jurisdiction_note says
-- so in those words rather than implying coverage the registry does not have.
--
-- THREE CANDIDATES WERE REJECTED ON THE MALAYSIA TEST. Every page was diffed
-- against ALL the others rather than pairwise-in-order, and the establishment
-- issuance page (283) and individual issuance page (289) carry THREE unique
-- lines each inside an eighty-plus-line shared menu — the imi.gov.my condition
-- exactly. They are not registered. The renewal page (288) is registered at
-- six unique lines because those six carry the fee table and a ministerial
-- decision number, which is substance the ratio alone cannot see.
--
-- Every assertion below guards a clause whose loss would NOT look like a loss.
--
--   THE PRIVATE-PERMIT FEE TABLES OVERLAP AND DISAGREE. 101 rial for one to
--   three domestic workers and 141 for four or more; but 141 for one to three
--   camel herders, livestock herders, grooms and farriers, and 241 for four or
--   more. A RESIDENTIAL BUILDING GUARD APPEARS IN BOTH LISTS at two different
--   prices, and the ministry does not reconcile them. Both tables are stored
--   as published and neither is derived from the other — deciding which one
--   "really" applies to a building guard is the ministry's call and not ours.
--
--   THE COMMERCIAL FEE DEPENDS ON A FILE PUBLISHED ELSEWHERE. 301, 251 and 201
--   rial by occupation category, and the category comes from the ministry's
--   separate occupation classification file. An employer cannot price a hire
--   from this page, and the page says so. Publishing the three numbers without
--   that dependency implies a lookup the reader cannot perform.
--
--   CANCELLATION HAS THREE DIFFERENT OUTCOMES AND THEY ARE NOT INTERCHANGEABLE.
--   Death or Omani nationality completes automatically. A visa change waits for
--   ROP proof. End of service or a failed medical waits for ROP departure
--   confirmation and then cancels itself. An employer told only "submit the
--   cancellation" will not know which of the three they are in.
--
--   THE ROP PROOF REQUIREMENT IS THE ONLY POINT WHERE THIS DESTINATION TOUCHES
--   THE AUTHORITY WE CANNOT READ, and losing it would hide the dependency that
--   makes Oman half a destination.
--
--   THE HEAT PERMIT'S WINDOW IS EXACT: 1 June to 31 August, 12:30 to 15:30.
--   Rounding it to "summer afternoons" turns a prohibition with a permit
--   attached into advice.
--
--   THE 90-DAY REPLACEMENT WINDOW decides whether a replacement-for-departed
--   permit exists at all.

update public.visa_requirements r
   set status = 'active', last_verified_at = '2026-08-24'::timestamptz
  from public.visa_types t
  join public.visa_countries c on c.id = t.country_id
 where t.id = r.visa_type_id and c.code = 'OM' and r.status = 'draft';

update public.visa_types t
   set data_quality = 'verified', last_verified_at = '2026-08-24'::timestamptz
  from public.visa_countries c
 where c.id = t.country_id and c.code = 'OM'
   and exists (select 1 from public.visa_requirements r
                where r.visa_type_id = t.id and r.status = 'active');

update public.visa_countries
   set support_state = 'supported', fee_currency = 'OMR',
       data_quality = 'verified', last_verified_at = '2026-08-24'::timestamptz
 where code = 'OM';

do $$
declare
  n_active integer; n_draft integer; n_nover integer; n_display integer;
  n_types integer; n_empty integer; n_outcomes integer;
  t1a text; t1b text; t2a text; t2b text; c1 text; c3 text;
begin
  select count(*) into n_active from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'OM' and r.status = 'active';
  if n_active <> 33 then raise exception 'Expected 33 active Omani requirements, found %', n_active; end if;

  select count(*) into n_draft from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'OM' and r.status = 'draft';
  if n_draft <> 0 then raise exception '% Omani requirement(s) left in draft', n_draft; end if;

  select count(*) into n_types from public.visa_types t
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'OM' and t.lifecycle_state = 'active';
  if n_types <> 6 then raise exception 'Expected 6 Omani routes, found %', n_types; end if;

  select count(*) into n_empty
    from public.visa_types t join public.visa_countries c on c.id = t.country_id
   where c.code = 'OM' and t.lifecycle_state = 'active'
     and not exists (select 1 from public.visa_requirements r
                      where r.visa_type_id = t.id and r.status = 'active');
  if n_empty <> 0 then raise exception '% Omani route(s) registered with no requirements', n_empty; end if;

  select count(*) into n_nover from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'OM' and r.source_version_id is null;
  if n_nover <> 0 then raise exception '% Omani requirement(s) have no source version', n_nover; end if;

  select count(*) into n_display from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'OM' and r.status = 'active' and r.source_excerpt_display is null;
  if n_display <> 0 then raise exception '% active Omani requirement(s) cannot quote their authority', n_display; end if;

  -- THE TWO OVERLAPPING FEE TABLES MUST BOTH SURVIVE, WITH ALL FOUR AMOUNTS.
  select parameters->>'tier1_1to3_omr', parameters->>'tier1_4plus_omr' into t1a, t1b
    from public.visa_requirements where requirement_code = 'fee_101_141_domestic_occupations';
  select parameters->>'tier2_1to3_omr', parameters->>'tier2_4plus_omr' into t2a, t2b
    from public.visa_requirements where requirement_code = 'fee_141_241_livestock_occupations';
  if t1a <> '101' or t1b <> '141' or t2a <> '141' or t2b <> '241' then
    raise exception 'The Omani private-permit fee tables are wrong or flattened: %/% and %/%', t1a, t1b, t2a, t2b;
  end if;

  -- THE COMMERCIAL BANDS AND THEIR DEPENDENCY ON THE CLASSIFICATION FILE.
  select parameters->>'category_1_omr', parameters->>'category_3_omr' into c1, c3
    from public.visa_requirements where requirement_code = 'fee_bands_by_occupation_category';
  if c1 <> '301' or c3 <> '201' then
    raise exception 'The Omani commercial fee bands have moved: category 1 = %, category 3 = %', c1, c3;
  end if;

  -- CANCELLATION'S THREE OUTCOMES AND THE ROP DEPENDENCY.
  select count(*) into n_outcomes from public.visa_requirements r
   where r.requirement_code in ('automatic_completion_for_death_or_nationality',
                                'end_of_service_waits_for_rop_departure_confirmation',
                                'rop_proof_required_for_visa_changes');
  if n_outcomes <> 3 then
    raise exception 'A cancellation outcome or the ROP proof dependency is missing: % of 3', n_outcomes;
  end if;

  -- THE HEAT PERMIT WINDOW, EXACT.
  if (select parameters->>'start_time' from public.visa_requirements
       where requirement_code = 'window_and_hours') <> '12:30'
     or (select parameters->>'to' from public.visa_requirements
          where requirement_code = 'window_and_hours') <> '08-31' then
    raise exception 'The Omani midday-work prohibition window has been rounded';
  end if;

  -- THE 90-DAY REPLACEMENT WINDOW.
  if (select parameters->>'days' from public.visa_requirements
       where requirement_code = 'replacement_within_90_days_of_arrival') <> '90' then
    raise exception 'The 90-day replacement-for-departed window is wrong or missing';
  end if;

  -- The ROP portal serves no text and must never be registered.
  if exists (select 1 from public.visa_sources s join public.visa_countries c on c.id = s.country_id
              where c.code = 'OM' and s.source_url like '%rop.gov.om%') then
    raise exception 'The ROP e-Visa portal is client-rendered and must not be registered';
  end if;

  raise notice 'Oman live: % work-permit requirements active across % routes', n_active, n_types;
end $$;

commit;
