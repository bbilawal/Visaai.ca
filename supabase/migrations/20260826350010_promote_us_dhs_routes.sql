-- The six blocked US routes go live: 117 requirements, all quoted from DHS.
--
-- These routes have existed in the registry, registered and empty, for as long
-- as the registry has. They were empty because their only sources were on
-- travel.state.gov, which answers HTTP 403 on robots.txt to our monitor. The
-- host still does. What changed is that we stopped treating one refusing host
-- as the country's answer and read the three DHS components that publish the
-- same subjects and permit us.
--
-- Every assertion below guards a clause whose loss would NOT look like a loss.
-- The page would still read as a complete, confident requirement, and would be
-- wrong in the direction that costs someone a refusal, a fee, or a status.
--
--   THE B-2 GAP MUST STAY VISIBLE. USCIS publishes B-1 and has no B-2 page,
--   because B-2 involves no work. The visitor route therefore carries B-1
--   eligibility and no B-2 eligibility, and every eligibility requirement on it
--   is labelled "B-1:". Dropping those labels would present business-visitor
--   criteria as the rules for tourists, which is the single most reachable
--   wrong answer on this destination.
--
--   THE SIX CATEGORIES THAT CANNOT EXTEND. Visa Waiver Program, D crew, C
--   transit, transit without visa, K fiancé(e) and S informant may not apply to
--   extend at all. The first entry catches most short-stay visitors to the
--   United States. Losing this clause turns "you may extend up to 6 months"
--   into advice that cannot be followed by the people most likely to need it.
--
--   TRANSIT CANNOT BE EXTENDED, AND THAT IS THE TRANSIT ROUTE'S ONE REAL RULE.
--   The C-1 criteria live on the host that refuses us. What a readable DHS page
--   does state is that a person admitted in transit may not extend. A missed
--   connection cannot be regularised by filing. If that clause goes, the route
--   has nothing left that is both readable and true.
--
--   THE I-94 DATE, NOT THE VISA DATE. Both USCIS and CBP state that the
--   admission record carries the date the stay expires. Applicants read the
--   visa. Publishing a period of stay without the "check your I-94" clause
--   invites a lawful-looking overstay.
--
--   E-1 IS TRADE AND E-2 IS CAPITAL. The two pages share their employee tests,
--   period of stay and family provisions almost word for word, which makes them
--   look like variants. They are not: E-1 turns on trade that is substantial
--   and over 50% bilateral; E-2 turns on capital that is substantial, at risk,
--   lawfully sourced, and in an enterprise that is not marginal. There is no
--   marginality test in E-1 and no 50% trade test in E-2. Cross-quoting them
--   would produce a confidently wrong answer that verifies against nothing.
--
--   NO DOLLAR FIGURE FOR "SUBSTANTIAL". USCIS states that the E-2 threshold is
--   proportionate — the cheaper the business, the higher the share — and
--   publishes no amount. This is the most tempting field on the destination to
--   complete from memory, and there is nothing on the page to complete it from.
--
--   THE TREATY COUNTRY LIST IS ABSENT AND MUST STAY ABSENT. Nationality is the
--   FIRST test of both E classifications and the list is held by the Department
--   of State. We can say a qualifying treaty is required; we cannot say whether
--   a given country has one. Supplying that list from memory would be the exact
--   fabrication the exception ledger exists to prevent.
--
--   M-1 AND F-1 ARE NOT THE SAME STUDENT. M-1 excludes language training,
--   forbids employment during the programme, must hold status for the whole
--   time the I-539 is pending, cannot change to F inside the country, and gets
--   30 days after the programme rather than 60. Five separate divergences, each
--   one capable of ending a status on its own.
--
--   STUDYING ON B-1 OR B-2 IS PROHIBITED AND POISONS THE CHANGE OF STATUS.
--   USCIS states both halves: the prohibition, and that having enrolled anyway
--   makes the applicant ineligible for the very change they are applying for.
--   The second half is what makes the first half urgent.
--
--   THE DHS FINAL RULE OF 17 JULY 2026 CONTRADICTS ITS OWN DEPARTMENT. USCIS
--   still describes F and J admission as "duration of status" on pages last
--   reviewed in 2024 and 2025; SEVP announces a final rule replacing it with a
--   fixed period of admission. Both are DHS. The announcement is published as
--   an announcement and the older quotes stand as quoted, because resolving the
--   contradiction ourselves would publish a rule that neither page states.
--
--   J-1 HAS NO USCIS EXTENSION. The sponsor extends the programme; there is no
--   Form I-539 and no filing. A reader who is told to file will file the wrong
--   thing, pay for it, and still lose status.
--
--   J-2 MAY WORK AND THAT INCOME MAY NOT SUPPORT THE PRINCIPAL. Both halves are
--   on the page. Publishing only the first misstates the family's finances.

update public.visa_requirements r
   set status = 'active', last_verified_at = '2026-08-24'::timestamptz
  from public.visa_types t
  join public.visa_countries c on c.id = t.country_id
 where t.id = r.visa_type_id
   and c.code = 'US'
   and t.visaai_id in (
     'us-business-visitor',
     'us-visitor-visa-b-1-business-b-2-tourism',
     'us-student-visa-academic-f-vocational-m',
     'us-exchange-visitor',
     'us-treaty-trader-treaty-investor',
     'us-transiting-the-united-states')
   and r.status = 'draft';

update public.visa_types t
   set data_quality = 'verified', last_verified_at = '2026-08-24'::timestamptz
  from public.visa_countries c
 where c.id = t.country_id and c.code = 'US'
   and exists (select 1 from public.visa_requirements r
                where r.visa_type_id = t.id and r.status = 'active');

do $$
declare
  n_active integer; n_draft integer; n_state integer;
  n_b1_labelled integer; n_cannot_extend integer; n_transit_extend integer;
  n_i94 integer; n_marginal integer; n_trade50 integer; n_dollar integer;
  n_m1 integer; n_b1b2_study integer; n_finalrule integer; n_j1_ext integer;
  n_j2 integer; n_display integer; n_nover integer;
begin
  select count(*) into n_active
    from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'US' and r.status = 'active'
     and t.visaai_id in ('us-business-visitor','us-visitor-visa-b-1-business-b-2-tourism',
       'us-student-visa-academic-f-vocational-m','us-exchange-visitor',
       'us-treaty-trader-treaty-investor','us-transiting-the-united-states');
  if n_active <> 117 then
    raise exception 'Expected 117 newly active US requirements, found %', n_active;
  end if;

  select count(*) into n_draft
    from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'US' and r.status = 'draft';
  if n_draft <> 0 then raise exception '% US requirement(s) left in draft', n_draft; end if;

  -- Every requirement must still be bound to the exact page version it was read
  -- from. A null here would mean a claim with no evidence behind it.
  select count(*) into n_nover
    from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'US' and r.source_version_id is null;
  if n_nover <> 0 then raise exception '% US requirement(s) have no source version', n_nover; end if;

  -- THE B-2 GAP. Every eligibility condition on the visitor route names B-1.
  select count(*) into n_b1_labelled
    from public.visa_requirements r join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'us-visitor-visa-b-1-business-b-2-tourism' and r.label like 'B-1:%';
  if n_b1_labelled < 6 then
    raise exception 'The visitor route must label its B-1-only eligibility as B-1; found % such rows', n_b1_labelled;
  end if;

  -- THE SIX CATEGORIES THAT CANNOT EXTEND.
  select count(*) into n_cannot_extend
    from public.visa_requirements r join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'us-visitor-visa-b-1-business-b-2-tourism'
     and r.source_excerpt like '%visa waiver program; crew member (d nonimmigrant visa); in transit%';
  if n_cannot_extend <> 1 then
    raise exception 'The list of categories that may not extend is missing from the visitor route';
  end if;

  -- TRANSIT CANNOT BE EXTENDED — the transit route's one readable rule.
  select count(*) into n_transit_extend
    from public.visa_requirements r join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'us-transiting-the-united-states'
     and r.requirement_code = 'transit_admission_cannot_be_extended';
  if n_transit_extend <> 1 then
    raise exception 'The transit route has lost the one rule about transit a readable DHS page states';
  end if;

  -- THE I-94 DATE, on both routes that describe a period of stay.
  select count(*) into n_i94
    from public.visa_requirements r join public.visa_types t on t.id = r.visa_type_id
   where r.requirement_code in ('check_i94_date_not_visa_date','i94_is_the_proof_of_legal_visitor_status',
                                'm_students_latest_date_is_the_i94_admit_until');
  if n_i94 < 4 then
    raise exception 'The I-94-is-the-controlling-date clauses are incomplete: % found', n_i94;
  end if;

  -- E-1 IS TRADE, E-2 IS CAPITAL. Both discriminators must survive.
  select count(*) into n_marginal from public.visa_requirements r
   where r.requirement_code = 'e2_enterprise_must_not_be_marginal';
  select count(*) into n_trade50 from public.visa_requirements r
   where r.requirement_code = 'e1_principal_trade_over_50_percent';
  if n_marginal <> 1 or n_trade50 <> 1 then
    raise exception 'E-1/E-2 discriminators lost: marginality=%, 50%% trade=%', n_marginal, n_trade50;
  end if;
  if (select parameters->>'principal_trade_share_minimum_percent'
        from public.visa_requirements where requirement_code = 'e1_principal_trade_over_50_percent') <> '50' then
    raise exception 'The E-1 principal-trade threshold has moved off 50 per cent';
  end if;

  -- NO DOLLAR FIGURE FOR "SUBSTANTIAL". USCIS publishes none; nor may we.
  select count(*) into n_dollar
    from public.visa_requirements r join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'us-treaty-trader-treaty-investor'
     and (r.label ~ '\$[0-9]' or r.description ~ '\$[0-9]' or r.parameters::text ~ '"[a-z_]*(amount|usd|capital)[a-z_]*"\s*:\s*[0-9]');
  if n_dollar <> 0 then
    raise exception 'A monetary threshold has appeared on the E route; USCIS publishes none';
  end if;

  -- M-1 AND F-1 ARE NOT THE SAME STUDENT: five divergences, each load-bearing.
  select count(*) into n_m1
    from public.visa_requirements r
   where r.requirement_code in ('m1_vocational_programme_excludes_language_training',
                                'm1_no_employment_during_programme',
                                'm1_must_hold_valid_status_while_pending',
                                'm1_cannot_change_to_f_status_inside_the_us',
                                'm_students_latest_date_is_the_i94_admit_until');
  if n_m1 <> 5 then
    raise exception 'The F/M divergences are incomplete: % of 5 present', n_m1;
  end if;

  -- STUDYING ON B-1/B-2 IS PROHIBITED, and the consequence travels with it.
  select count(*) into n_b1b2_study
    from public.visa_requirements r
   where r.requirement_code in ('study_prohibited_in_b1_b2_status','status_violation_removes_eligibility');
  if n_b1b2_study <> 2 then
    raise exception 'The B-status study prohibition and its consequence must both be published; % found', n_b1b2_study;
  end if;

  -- THE 17 JULY 2026 FINAL RULE, published as an announcement, not a rule.
  select count(*) into n_finalrule
    from public.visa_requirements r
   where r.requirement_code = 'dhs_final_rule_fixed_period_of_admission'
     and r.officially_required = false;
  if n_finalrule <> 1 then
    raise exception 'The DHS final rule of 17 July 2026 must be published, and as officially_required false';
  end if;

  -- J-1 HAS NO USCIS EXTENSION, and J-2 income may not support the principal.
  select count(*) into n_j1_ext from public.visa_requirements r
   where r.requirement_code = 'duration_of_status_governed_by_ds_2019';
  select count(*) into n_j2 from public.visa_requirements r
   where r.requirement_code = 'family_j2_and_dependant_employment'
     and r.source_excerpt like '%their income may not be used to support you%';
  if n_j1_ext <> 1 or n_j2 <> 1 then
    raise exception 'J-1 duration-of-status (%) or the J-2 income clause (%) is missing', n_j1_ext, n_j2;
  end if;

  -- Every published requirement must be able to quote the authority in the
  -- authority's own casing. A null display excerpt renders no quote at all.
  select count(*) into n_display
    from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'US' and r.status = 'active' and r.source_excerpt_display is null;
  if n_display <> 0 then
    raise exception '% active US requirement(s) cannot quote their authority', n_display;
  end if;

  select count(*) into n_state
    from public.visa_sources s join public.visa_countries c on c.id = s.country_id
   where c.code = 'US' and s.authority_rank = 1
     and (s.source_url like 'https://travel.state.gov/%' or s.source_url like 'https://ceac.state.gov/%');
  if n_state <> 0 then
    raise exception 'A State Department source has been promoted to rank 1 behind a host that refuses us';
  end if;

  raise notice 'US: % requirements now active across 6 previously empty routes', n_active;
end $$;
