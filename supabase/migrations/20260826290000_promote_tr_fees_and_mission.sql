-- Türkiye finished: fees on every residence route, plus the mission-personnel
-- route. Türkiye reaches 15 live routes and 272 requirements — 96 across the
-- eight Ministry of Foreign Affairs visa routes and 176 across the seven
-- Presidency of Migration Management routes.
--
-- Four assertions beyond provenance.
--
--   THE SCOPING SENTENCE MUST SURVIVE ON ALL SIX. The per-day and per-month
--   permit fees apply ONLY to citizens of countries placed in no country group,
--   and the authority names them: Serbia, Fiji, Norway and the Northern Mariana
--   Islands. Published without that sentence the figures read as universal and
--   would misprice every other nationality on the page. This is the single most
--   dangerous omission available in the whole fee block.
--
--   THE RECIPROCITY EXEMPTIONS MUST SURVIVE WHOLE. Ten jurisdictions pay no
--   permit fee at all. A truncated list is worse than none, because the reader
--   cannot tell it was truncated.
--
--   THE FIRST-MONTH FLOOR AND CEILING TRAVEL WITH THE DAILY RATE. TRY 348.10 per
--   day, but never less than 653.70 and never more than 3,359.90 for the first
--   month. Quoting the daily rate alone overcharges a three-day stay and
--   undercharges a long one.
--
--   THE MISSION ROUTE CARRIES NO FEE. The identity card EXEMPTS its holder from
--   a residence permit, so a fee requirement on it would tell a diplomat to pay
--   for something they do not need.

update public.visa_requirements r
   set status = 'active', last_verified_at = '2026-08-26'::timestamptz
  from public.visa_types t
  join public.visa_countries c on c.id = t.country_id
 where t.id = r.visa_type_id
   and c.code = 'TR'
   and r.status = 'draft';

update public.visa_types t
   set data_quality = 'verified', last_verified_at = '2026-08-26'::timestamptz
  from public.visa_countries c
 where c.id = t.country_id and c.code = 'TR'
   and exists (select 1 from public.visa_requirements r
                where r.visa_type_id = t.id and r.status = 'active');

do $$
declare
  n_active integer; n_bad integer; n_pages integer;
  n_scope integer; n_exempt integer; n_floor integer; n_mission_fee integer;
  n_heading integer; n_bare integer;
begin
  select count(*) into n_active from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'TR' and r.status = 'active';
  -- 96 (MFA visas) + 176 (migration routes) = 272. The first version of this
  -- line said 291, which was my arithmetic rather than the data, and the
  -- assertion refused to commit on it. That is the assertion working.
  if n_active <> 272 then raise exception 'Expected 272 active TR requirements, found %', n_active; end if;

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

  select count(*) into n_bare from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'TR' and r.status = 'active' and r.kind = 'fee'
     and r.source_excerpt ~* '^[0-9 ,.]*(tl|try)[0-9 ,.]*$';
  if n_bare > 0 then
    raise exception '% TR fee(s) quote a BARE AMOUNT with no indication of what it buys', n_bare;
  end if;

  -- The sentence that stops the figures being read as universal, on all six.
  select count(*) into n_scope from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where r.status = 'active'
     and r.requirement_code = 'fee_amounts_scoped_to_ungrouped_countries'
     and r.source_excerpt like '%not included in any country group%';
  if n_scope <> 6 then
    raise exception 'The fee scoping sentence must be on all 6 ordinary residence routes; found %', n_scope;
  end if;

  -- The exemption list, whole, on all six.
  select count(*) into n_exempt from public.visa_requirements r
   where r.status = 'active'
     and r.requirement_code = 'fee_reciprocity_exemptions'
     and r.source_excerpt like '%czech republic%'
     and r.source_excerpt like '%palestine%';
  if n_exempt <> 6 then
    raise exception 'The reciprocity exemption list must be quoted whole on all 6 routes; found %', n_exempt;
  end if;

  -- The floor and ceiling that travel with the daily rate.
  select count(*) into n_floor from public.visa_requirements r
   where r.status = 'active'
     and r.requirement_code = 'fee_permit_per_day_first_month'
     and r.source_excerpt like '%653.70%'
     and r.source_excerpt like '%3.359.90%';
  if n_floor <> 6 then
    raise exception 'The first-month floor and ceiling must travel with the daily rate on all 6 routes; found %', n_floor;
  end if;

  -- The exempt route must carry no fee at all.
  select count(*) into n_mission_fee from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'tr-foreign-mission-personnel' and r.status = 'active' and r.kind = 'fee';
  if n_mission_fee <> 0 then
    raise exception 'The mission-personnel route is EXEMPT from residence permit fees; found % fee requirement(s)', n_mission_fee;
  end if;

  select count(*) into n_pages from public.visa_publishable_pages where country_code = 'TR';
  if n_pages <> 15 then raise exception 'Türkiye should publish 15 pages, found %', n_pages; end if;

  raise notice 'Türkiye COMPLETE: 15 routes, % requirements across two authorities', n_active;
end $$;
