begin;

-- Jordan and Qatar go live: one route each, 13 requirements between them.
--
-- These are the thinnest destinations in the registry and they are registered
-- thin on purpose. Both publish a single page with real requirement content
-- and defer everything else to an authority we cannot read. The alternative
-- was to leave two countries in the exception ledger while a readable, quotable
-- official page sat unused — or to pad them out of pages that are about
-- something else, which is what Kuwait and Iraq would have required and is why
-- neither is here.
--
-- Every assertion below guards a clause whose loss would NOT look like a loss.
--
--   JORDAN NAMES THREE MECHANISMS AND NO NATIONALITIES. Single-entry tourist
--   visa, visa on arrival at the main entry points, and e-visa. The page says
--   visa on arrival is available to nationals of "many countries" and lists
--   none of them. A reader who takes "Jordan offers visa on arrival" as an
--   answer will book a flight on it. The gap is the authority's and it must
--   stay visible.
--
--   THE 1-OR-3-MONTH STAY IS THE ONLY DURATION JORDAN PUBLISHES, and it is
--   qualified — "usually", and depending on the type and purpose.
--
--   JORDAN PUBLISHES NO FEE AND SAYS SO. It states that fees vary by type and
--   duration and refers the reader elsewhere. That referral is recorded as a
--   requirement precisely so no figure is ever supplied in its place.
--
--   QATAR PUBLISHES A PRICE AND NOT AN ELIGIBILITY. Seven visa types with QAR
--   amounts, one exempted, and a referral to the Ministry of Interior for
--   everything else. The inversion is unusual and the jurisdiction_note says
--   so; if the fee table goes, the destination has nothing left.
--
--   QATAR'S ROUTE IS THE EXCEPTION CHANNEL. The Consular Affairs Department
--   handles applications that CANNOT go through the electronic visa system.
--   Presenting it as the main route would send most applicants to the wrong
--   place.

update public.visa_requirements r
   set status = 'active', last_verified_at = '2026-08-24'::timestamptz
  from public.visa_types t
  join public.visa_countries c on c.id = t.country_id
 where t.id = r.visa_type_id and c.code in ('JO','QA') and r.status = 'draft';

update public.visa_types t
   set data_quality = 'verified', last_verified_at = '2026-08-24'::timestamptz
  from public.visa_countries c
 where c.id = t.country_id and c.code in ('JO','QA')
   and exists (select 1 from public.visa_requirements r
                where r.visa_type_id = t.id and r.status = 'active');

update public.visa_countries set support_state = 'supported', data_quality = 'verified',
       last_verified_at = '2026-08-24'::timestamptz where code = 'JO';
update public.visa_countries set support_state = 'supported', fee_currency = 'QAR',
       data_quality = 'verified', last_verified_at = '2026-08-24'::timestamptz where code = 'QA';

do $$
declare n_active integer; n_draft integer; n_nover integer; n_display integer; n_empty integer;
begin
  select count(*) into n_active from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code in ('JO','QA') and r.status = 'active';
  if n_active <> 13 then raise exception 'Expected 13 active requirements across JO and QA, found %', n_active; end if;

  select count(*) into n_draft from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code in ('JO','QA') and r.status = 'draft';
  if n_draft <> 0 then raise exception '% requirement(s) left in draft', n_draft; end if;

  select count(*) into n_empty from public.visa_types t
    join public.visa_countries c on c.id = t.country_id
   where c.code in ('JO','QA') and t.lifecycle_state = 'active'
     and not exists (select 1 from public.visa_requirements r
                      where r.visa_type_id = t.id and r.status = 'active');
  if n_empty <> 0 then raise exception '% route(s) registered with no requirements', n_empty; end if;

  select count(*) into n_nover from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code in ('JO','QA') and r.source_version_id is null;
  if n_nover <> 0 then raise exception '% requirement(s) have no source version', n_nover; end if;

  select count(*) into n_display from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code in ('JO','QA') and r.status = 'active' and r.source_excerpt_display is null;
  if n_display <> 0 then raise exception '% requirement(s) cannot quote their authority', n_display; end if;

  -- JORDAN'S THREE MECHANISMS AND ITS ABSENT NATIONALITY LIST.
  if (select count(*) from public.visa_requirements
       where requirement_code in ('single_entry_tourist_visa_is_the_usual_route',
         'visa_on_arrival_at_main_entry_points','evisa_available_before_arrival')) <> 3 then
    raise exception 'Jordan must publish all three entry mechanisms';
  end if;
  if (select count(*) from public.visa_requirements r
       join public.visa_types t on t.id = r.visa_type_id
      where t.visaai_id = 'jo-tourist-visa'
        and (r.label ~* 'nationals of (the )?(following|these)' or r.parameters::text ~* 'nationalit')) <> 0 then
    raise exception 'A nationality list has appeared on the Jordan route; the authority publishes none';
  end if;

  -- JORDAN PUBLISHES NO FEE FIGURE.
  if (select count(*) from public.visa_requirements r
       join public.visa_types t on t.id = r.visa_type_id
      where t.visaai_id = 'jo-tourist-visa' and r.kind = 'fee'
        and r.parameters::text ~ '[0-9]') <> 0 then
    raise exception 'A fee amount has appeared on the Jordan route; the authority publishes none';
  end if;

  -- QATAR'S FEE TABLE IS THE DESTINATION.
  if (select parameters->>'businessmen_visas' from public.visa_requirements
       where requirement_code = 'seven_visa_types_and_their_fees') <> '200'
     or (select parameters->>'official_visas' from public.visa_requirements
          where requirement_code = 'seven_visa_types_and_their_fees') <> 'exempted' then
    raise exception 'The Qatari fee table has been altered or lost its exempted row';
  end if;
  if not exists (select 1 from public.visa_requirements
                  where requirement_code = 'consular_department_handles_non_electronic_cases') then
    raise exception 'Qatar must state that this channel is for applications the e-visa system cannot take';
  end if;

  -- Kuwait and Iraq stay unsupported: their readable pages are about a
  -- directorate mandate and about Iraqi passports respectively.
  if exists (select 1 from public.visa_countries where code in ('KW','IQ') and support_state <> 'unsupported') then
    raise exception 'Kuwait and Iraq have no inbound-visa page and must stay unsupported';
  end if;

  raise notice 'Jordan and Qatar live: % requirements across 2 routes', n_active;
end $$;

commit;
