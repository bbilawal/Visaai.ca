-- France goes live: 18 routes, 222 requirements, from a host an earlier pass
-- looked at and walked away from.
--
-- THE MISS IS WORTH RECORDING BEFORE THE PROMOTION. France was filed as
-- `blocked_by_authority` and the evidence was sound — france-visas.gouv.fr
-- answers HTTP 403 on robots.txt from two separate egress paths, which is
-- policy rather than IP reputation, and it stays unread. But an earlier pass
-- also probed service-public.fr, using node N19806. That node is
-- "Travail - Formation", the general employment theme for everyone in France.
-- The foreign-nationals tree is N19804, "Étranger - Europe". One digit apart,
-- an entirely different subject, and the null was recorded as a fact about the
-- country rather than about the probe.
--
-- WHAT KIND OF SOURCE THIS IS. Service-Public.gouv.fr is published by DILA, a
-- service of the Prime Minister. It is the French State's own public-service
-- publisher and it describes the rules; it does not decide applications.
-- Préfectures decide residence permits and France-Visas issues visas. That is
-- recorded in `jurisdiction_note` rather than glossed, because a reader who
-- thinks they are reading the préfecture writes to the wrong office.
--
-- Every assertion below guards a clause whose loss would NOT look like a loss.
--
--   THE THREE LONG-STAY DOCUMENTS HAVE THREE DIFFERENT CLOCKS. A VLS-TS is
--   itself a residence permit and must be validated online within THREE months
--   of arrival. A visa marked "carte de séjour à solliciter dans les 2 mois"
--   is not, and needs a préfecture application within TWO. A vacances-travail
--   visa is a third thing whose terms are set per bilateral agreement.
--   Publishing one deadline as "the" deadline gives two thirds of holders the
--   wrong one, and an unvalidated VLS-TS holder is not in regular status and
--   cannot re-cross the Schengen border.
--
--   THE RENEWAL WINDOW IS CLOSED AT BOTH ENDS. At the earliest four months and
--   at the latest two months before expiry. Late filing costs an extra €180 on
--   its own. A window rendered as a deadline invites an early filing that is
--   refused.
--
--   A2 FOR THE MULTI-YEAR CARD, B1 FOR THE RESIDENT CARD, AND TWO DIFFERENT
--   CIVIC EXAMS. These are the only tests in the French system that are about
--   the person rather than their circumstances, they are new obligations at the
--   renewal step, and passing the multi-year exam does not satisfy the resident
--   one. Both are waived over 65 and that waiver must travel with them.
--
--   FIVE CARDS CANNOT LEAD TO A MULTI-YEAR CARD ON THE SAME GROUND — visitor,
--   au pair, intern, temporary worker, and the trafficking/protection variant of
--   vie privée et familiale. Holders of exactly these are the most likely to
--   assume renewal is routine.
--
--   THE ABSENCE LIMITS DIFFER BY ROUTE INTO THE SAME CARD. EU long-term
--   residence: six consecutive months and ten in total on the general route,
--   twelve and eighteen on the Blue Card route. One rule applied to both
--   disqualifies people who qualify.
--
--   NOT EVERY PERMIT COUNTS TOWARD THE FIVE YEARS, and two entries in the
--   qualifying list carry carve-outs inside them — 'talent' excludes salarié en
--   mission and their family, 'vie privée et familiale' excludes subsidiary
--   protection and certain complaint and witness cases.
--
--   FRANCE'S EU BLUE CARD THRESHOLD IS ITS OWN. 1.5 times the average annual
--   gross reference salary, €59,373.00. The registry already holds Dutch and
--   Swedish Blue Card figures; crossing them produces a confidently wrong number
--   that verifies against nothing. The FORMULA is stored beside the amount so
--   the figure going stale is detectable rather than silent.
--
--   THE WORK AUTHORISATION IS A MATRIX, NOT A RULE. Whether an employer needs
--   one depends on the permit, and the answers are opposite in places that look
--   identical: an EU long-term residence card issued in France permits work, the
--   same card issued by another member state does not. A 'vie privée et
--   familiale' card obtained as family of an EU long-term resident elsewhere
--   does not permit work in the FIRST YEAR. 'Visiteur' cannot work at all and
--   cannot even apply.
--
--   SILENCE MEANS DIFFERENT THINGS ON DIFFERENT ROUTES. An internship agreement
--   not answered within 30 days is REFUSED. A préfecture silent for 90 days on
--   a student permit is an implicit refusal. A visa unanswered for 2 months is
--   an implicit refusal starting a 30-day RAPO clock. An employer's
--   authenticity check unanswered in 2 working days is DISCHARGED. Four rules,
--   four meanings, and the wrong one loses the case.
--
--   THE TUNISIAN MARRIAGE PERIOD IS ONE YEAR, NOT THREE. A nationality-specific
--   qualifying period inside an otherwise uniform rule.
--
--   THE €180 AND THE NON-REFUNDABLE €100. Late filing adds €180. Entering
--   without a long-stay visa adds €300, of which €100 is due on filing and is
--   not returned if the card is refused — the only non-refundable payment on the
--   destination, and it falls before any decision.
--
--   TWO RESOURCE FIGURES ON ONE PAGE THAT DO NOT MULTIPLY. The visitor card
--   states €1,477.93 net monthly "sur 1 année" and its document list asks for an
--   annual €17,735.19. Twelve times the first is €17,735.16. Both are stored as
--   published and neither is derived from the other: silently correcting a
--   government figure to make our arithmetic work is how a wrong number gets a
--   real citation attached to it.

update public.visa_requirements r
   set status = 'active', last_verified_at = '2026-08-24'::timestamptz
  from public.visa_types t
  join public.visa_countries c on c.id = t.country_id
 where t.id = r.visa_type_id and c.code = 'FR' and r.status = 'draft';

update public.visa_types t
   set data_quality = 'verified', last_verified_at = '2026-08-24'::timestamptz
  from public.visa_countries c
 where c.id = t.country_id and c.code = 'FR'
   and exists (select 1 from public.visa_requirements r
                where r.visa_type_id = t.id and r.status = 'active');

update public.visa_countries
   set support_state = 'supported',
       fee_currency  = 'EUR',
       data_quality  = 'verified',
       last_verified_at = '2026-08-24'::timestamptz
 where code = 'FR';

do $$
declare
  n_active integer; n_draft integer; n_nover integer; n_display integer;
  n_types integer; n_vlsts integer; n_window integer; n_a2 integer; n_b1 integer;
  n_excluded integer; n_abs integer; n_bluecard integer; n_matrix integer;
  n_silence integer; n_tunisia integer; n_nonref integer; n_visitor_pair integer;
  bc_amount text; bc_formula text;
begin
  select count(*) into n_active from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'FR' and r.status = 'active';
  if n_active <> 222 then raise exception 'Expected 222 active French requirements, found %', n_active; end if;

  select count(*) into n_draft from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'FR' and r.status = 'draft';
  if n_draft <> 0 then raise exception '% French requirement(s) left in draft', n_draft; end if;

  select count(*) into n_types from public.visa_types t
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'FR' and t.lifecycle_state = 'active';
  if n_types <> 18 then raise exception 'Expected 18 French routes, found %', n_types; end if;

  -- Evidence must stay attached to the exact page version it was read from.
  select count(*) into n_nover from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'FR' and r.source_version_id is null;
  if n_nover <> 0 then raise exception '% French requirement(s) have no source version', n_nover; end if;

  -- Every published requirement must be able to quote the authority in French,
  -- in the authority's own casing. A null renders no quotation at all.
  select count(*) into n_display from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'FR' and r.status = 'active' and r.source_excerpt_display is null;
  if n_display <> 0 then raise exception '% active French requirement(s) cannot quote their authority', n_display; end if;

  -- THE THREE-MONTH VLS-TS VALIDATION, on every route that issues one.
  select count(*) into n_vlsts from public.visa_requirements r
   where r.requirement_code in ('vls_ts_must_be_validated_within_three_months',
                                'validate_vls_ts_within_three_months',
                                'under_twelve_months_visa_validated_within_three_months');
  if n_vlsts < 4 then
    raise exception 'The VLS-TS three-month validation deadline is missing from routes that issue one: % found', n_vlsts;
  end if;

  -- THE RENEWAL WINDOW, CLOSED AT BOTH ENDS.
  select count(*) into n_window from public.visa_requirements r
   where r.parameters ? 'earliest_months_before_expiry'
     and (r.parameters->>'earliest_months_before_expiry') = '4'
     and (r.parameters->>'latest_months_before_expiry') = '2';
  if n_window < 3 then
    raise exception 'The four-to-two-months filing window has been flattened to a deadline on % route(s)', n_window;
  end if;

  -- A2 FOR THE MULTI-YEAR CARD, B1 FOR THE RESIDENT CARD, both with the 65 waiver.
  select count(*) into n_a2 from public.visa_requirements r
   where r.requirement_code = 'french_at_a2_for_the_first_multi_year_card'
     and (r.parameters->>'exempt_if_older_than') = '65';
  select count(*) into n_b1 from public.visa_requirements r
   where r.requirement_code = 'french_at_b1_for_a_first_resident_card'
     and (r.parameters->>'exempt_if_older_than') = '65';
  if n_a2 <> 1 or n_b1 <> 1 then
    raise exception 'The language requirements or their over-65 waivers are lost: A2=%, B1=%', n_a2, n_b1;
  end if;

  -- FIVE CARDS EXCLUDED FROM SAME-GROUND RENEWAL.
  select count(*) into n_excluded from public.visa_requirements r
   where r.requirement_code = 'five_cards_excluded_from_same_motive_renewal'
     and r.source_excerpt like '%carte de séjour temporaire visiteur%'
     and r.source_excerpt like '%carte de séjour temporaire stagiaire%';
  if n_excluded <> 1 then
    raise exception 'The list of cards excluded from same-ground renewal is missing or truncated';
  end if;

  -- THE TWO ABSENCE REGIMES FOR EU LONG-TERM RESIDENCE.
  select count(*) into n_abs from public.visa_requirements r
   where r.requirement_code in ('absence_limits_general_route','absence_limits_blue_card_route');
  if n_abs <> 2 then
    raise exception 'EU long-term residence must publish BOTH absence regimes; % found', n_abs;
  end if;
  if (select parameters->>'max_consecutive_absence_months' from public.visa_requirements
       where requirement_code = 'absence_limits_general_route') <> '6'
     or (select parameters->>'max_consecutive_absence_months' from public.visa_requirements
          where requirement_code = 'absence_limits_blue_card_route') <> '12' then
    raise exception 'The two absence regimes have been flattened to one';
  end if;

  -- FRANCE'S OWN BLUE CARD THRESHOLD, formula and amount together.
  select parameters->>'annual_gross_salary_minimum_eur', parameters->>'salary_formula'
    into bc_amount, bc_formula
    from public.visa_requirements where requirement_code = 'blue_card_salary_formula_and_snapshot';
  if bc_amount is null or bc_formula is null then
    raise exception 'The French EU Blue Card threshold must store BOTH the amount and the formula (amount=%, formula=%)', bc_amount, bc_formula;
  end if;
  if bc_amount <> '59373.0' and bc_amount <> '59373' then
    raise exception 'The French Blue Card amount has moved off 59 373,00 EUR: %', bc_amount;
  end if;

  -- THE WORK AUTHORISATION MATRIX: the rows whose answers are opposite.
  select count(*) into n_matrix from public.visa_requirements r
   where r.requirement_code in ('matrix_visitor_card_cannot_work_at_all',
                                'matrix_eu_long_term_card_from_another_state_cannot_work',
                                'matrix_vpf_from_another_eu_state_no_work_first_year',
                                'matrix_salarie_needs_authorisation_per_contract');
  if n_matrix <> 4 then
    raise exception 'The work-authorisation matrix has lost a row whose answer is the opposite of its neighbour: % of 4', n_matrix;
  end if;

  -- SILENCE MEANS DIFFERENT THINGS. The internship refusal is the counterintuitive one.
  select count(*) into n_silence from public.visa_requirements r
   where r.requirement_code in ('silence_is_a_refusal_after_30_days',
                                'ninety_day_silence_is_an_implicit_refusal',
                                'refusal_may_be_implicit_after_two_months',
                                'two_month_silence_is_an_implicit_refusal');
  if n_silence <> 4 then
    raise exception 'The four different meanings of administrative silence are incomplete: % of 4', n_silence;
  end if;

  -- THE TUNISIAN ONE-YEAR MARRIAGE PERIOD.
  select count(*) into n_tunisia from public.visa_requirements r
   where r.requirement_code = 'three_years_of_marriage_one_for_tunisians'
     and (r.parameters->>'marriage_years_tunisian') = '1';
  if n_tunisia <> 1 then
    raise exception 'The Tunisian one-year marriage period has been flattened into the general three-year rule';
  end if;

  -- THE NON-REFUNDABLE €100.
  select count(*) into n_nonref from public.visa_requirements r
   where r.requirement_code = 'extra_300_euros_if_you_entered_without_a_long_stay_visa'
     and (r.parameters->>'non_refundable_on_filing_eur') = '100';
  if n_nonref <> 1 then
    raise exception 'The non-refundable 100 EUR due on filing is missing from the resident card';
  end if;

  -- THE TWO VISITOR FIGURES THAT DO NOT MULTIPLY, both stored as published.
  select count(*) into n_visitor_pair from public.visa_requirements r
   where r.requirement_code in ('minimum_monthly_resources_1477_93','annual_resources_evidence_17735_19');
  if n_visitor_pair <> 2 then
    raise exception 'The visitor card must publish both resource figures as the authority states them; % found', n_visitor_pair;
  end if;

  -- france-visas.gouv.fr refuses our monitor and must never be registered.
  if exists (select 1 from public.visa_sources s join public.visa_countries c on c.id = s.country_id
              where c.code = 'FR' and s.source_url like '%france-visas.gouv.fr%') then
    raise exception 'france-visas.gouv.fr refuses our monitor and must not be registered';
  end if;

  raise notice 'France live: % requirements active across % routes', n_active, n_types;
end $$;
