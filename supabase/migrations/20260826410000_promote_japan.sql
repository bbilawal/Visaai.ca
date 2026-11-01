-- Japan goes live: 13 routes, 57 requirements, quoted in Japanese from the
-- Immigration Services Agency.
--
-- THE MISS, BEFORE THE PROMOTION. Two earlier passes probed ISA and recorded
-- "NAVIGATION SHELL" — 3,402 characters at /isa/index.html, 2,402 at
-- /isa/applications/status/index.html, no requirement markers. Both readings
-- were accurate and both were of INDEX pages. That second index is a shell
-- listing 27 numbered residence statuses, each on its own page at 2,000 to
-- 18,500 characters. Stop at the router, miss the page below it: the Ireland
-- failure, repeated.
--
-- MOFA still answers 403 on robots.txt and is not registered. Japan splits the
-- decision — ISA grants the residence STATUS, MOFA issues the VISA — so this
-- destination publishes half of what an applicant needs and says so in
-- jurisdiction_note rather than implying the other half.
--
-- THE LANGUAGE DECISION. Sweden already set this precedent: quote the
-- authority in the authority's own language, and mark the English as ours.
-- official_name is each page's own H1 in Japanese; every label and description
-- is a VisaAI translation and is stated to be.
--
-- Every assertion below guards a clause whose loss would NOT look like a loss.
--
--   THE FOUR-CATEGORY EMPLOYER SYSTEM DECIDES THE DOCUMENT LIST. An applicant
--   with identical qualifications faces a materially different file depending
--   on who is hiring them, and the DEFAULT IS THE HEAVIEST: the authority
--   states that failing to produce category evidence places you in category 4.
--   Dropping that parenthesis turns a trap into an invisible one.
--
--   THE 15 APRIL 2026 LANGUAGE REQUIREMENT APPLIES TO CATEGORIES 3 AND 4 ONLY,
--   and its five deemed-equivalent routes relieve it entirely — JLPT N2, BJT
--   400, twenty years' residence, a Japanese degree, or Japanese compulsory
--   education plus high school. Publishing the requirement without the
--   equivalences sends people to sit a test they do not need.
--
--   SPECIFIED SKILLED WORKER LEVEL 2 IS ON THE DEPENDENT LIST AND LEVEL 1 IS
--   NOT. The Dependent status names seventeen sponsoring statuses and 特定技能２号
--   is among them while 特定技能１号 is absent. That single omission decides
--   whether a worker's family may join them, and it is invisible unless the
--   closed list is published in full.
--
--   THE SPOUSE-OF-PERMANENT-RESIDENT CHILD LIMB REQUIRES BIRTH IN JAPAN. A
--   child of a permanent resident born abroad is not covered by this status at
--   all. Rendering it as "spouse or child of a permanent resident" without the
--   birth and continuous-residence conditions is the most reachable wrong
--   answer on the destination.
--
--   HIGHLY SKILLED PROFESSIONAL TYPE 2 HAS NO EXPIRY. It is the only status in
--   the registered Japanese set with an unlimited period of residence, and a
--   Type 1 holder must still file a change-of-status application when their
--   activity or employer changes despite the relaxed activity limits.
--
--   THE PERIODS OF STAY ARE FIXED MENUS, NOT RANGES, AND THEY DIFFER. Most
--   working statuses offer 5/3/1 year or 3 months. Business Manager adds 6 and
--   4 months. Spouse of a permanent resident substitutes 6 months for 3.
--   Student and Dependent have no menu at all — the Minister designates the
--   period individually, within ceilings of 4 years 3 months and 5 years.
--   Temporary Visitor is 90, 30 or up to 15 days. Publishing one pattern as
--   "the Japanese period of stay" is wrong for most of the set.
--
--   NURSING CARE REQUIRES THE JAPANESE QUALIFICATION ITSELF, and the 1 April
--   2020 change was about the ROUTE to it, not about accepting an alternative.
--
--   CERTIFICATES UNDER THREE MONTHS OLD, TRANSLATIONS FOR EVERYTHING FOREIGN,
--   AND DOCUMENTS THAT ARE NOT RETURNED unless the request is made AT filing.
--   There is no later opportunity to ask for an original back.

update public.visa_requirements r
   set status = 'active', last_verified_at = '2026-08-24'::timestamptz
  from public.visa_types t
  join public.visa_countries c on c.id = t.country_id
 where t.id = r.visa_type_id and c.code = 'JP' and r.status = 'draft';

update public.visa_types t
   set data_quality = 'verified', last_verified_at = '2026-08-24'::timestamptz
  from public.visa_countries c
 where c.id = t.country_id and c.code = 'JP'
   and exists (select 1 from public.visa_requirements r
                where r.visa_type_id = t.id and r.status = 'active');

update public.visa_countries
   set support_state = 'supported',
       fee_currency  = 'JPY',
       data_quality  = 'verified',
       last_verified_at = '2026-08-24'::timestamptz
 where code = 'JP';

do $$
declare
  n_active integer; n_draft integer; n_nover integer; n_display integer;
  n_types integer; n_cat integer; n_lang integer; n_deemed integer;
  n_dep text; n_spouse integer; n_hsp2 integer; n_periods integer; n_care integer;
begin
  select count(*) into n_active from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'JP' and r.status = 'active';
  if n_active <> 57 then raise exception 'Expected 57 active Japanese requirements, found %', n_active; end if;

  select count(*) into n_draft from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'JP' and r.status = 'draft';
  if n_draft <> 0 then raise exception '% Japanese requirement(s) left in draft', n_draft; end if;

  select count(*) into n_types from public.visa_types t
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'JP' and t.lifecycle_state = 'active';
  if n_types <> 13 then raise exception 'Expected 13 Japanese routes, found %', n_types; end if;

  select count(*) into n_nover from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'JP' and r.source_version_id is null;
  if n_nover <> 0 then raise exception '% Japanese requirement(s) have no source version', n_nover; end if;

  select count(*) into n_display from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'JP' and r.status = 'active' and r.source_excerpt_display is null;
  if n_display <> 0 then
    raise exception '% active Japanese requirement(s) cannot quote their authority', n_display;
  end if;

  -- THE CATEGORY SYSTEM AND ITS DEFAULT.
  select count(*) into n_cat from public.visa_requirements r
   where r.requirement_code in ('employer_category_decides_the_document_list',
                                'failing_to_evidence_a_category_means_category_four',
                                'category_two_withholding_tax_threshold');
  if n_cat <> 3 then
    raise exception 'The four-category employer system or its category-4 default is missing: % of 3', n_cat;
  end if;

  -- THE 2026-04-15 LANGUAGE REQUIREMENT AND ITS FIVE EQUIVALENCES.
  select count(*) into n_lang from public.visa_requirements r
   where r.requirement_code = 'new_documents_for_categories_three_and_four_from_2026_04_15'
     and (r.parameters->>'effective_from') = '2026-04-15';
  select count(*) into n_deemed from public.visa_requirements r
   where r.requirement_code = 'deemed_b2_language_ability'
     and r.officially_required = false
     and r.source_excerpt like '%ｎ２以上%';
  if n_lang <> 1 or n_deemed <> 1 then
    raise exception 'The 2026-04-15 language requirement (%) or its deemed-equivalent routes (%) is missing', n_lang, n_deemed;
  end if;

  -- SPECIFIED SKILLED WORKER 2 IS ON THE DEPENDENT LIST, 1 IS NOT.
  select source_excerpt into n_dep from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'jp-dependent' and r.requirement_code = 'qualifying_activity_definition';
  if n_dep is null or position('特定技能２号' in n_dep) = 0 then
    raise exception 'The Dependent status must publish its closed sponsor list including 特定技能２号';
  end if;

  -- THE CHILD MUST HAVE BEEN BORN IN JAPAN.
  select count(*) into n_spouse from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'jp-spouse-or-child-of-permanent-resident'
     and r.requirement_code = 'who_qualifies'
     and r.source_excerpt like '%本邦で出生しその後引き続き本邦に在留している者%';
  if n_spouse <> 1 then
    raise exception 'The born-in-Japan and continuous-residence conditions on the child limb are missing';
  end if;

  -- HIGHLY SKILLED PROFESSIONAL TYPE 2 IS INDEFINITE.
  select count(*) into n_hsp2 from public.visa_requirements r
   where r.requirement_code = 'type_two_is_indefinite'
     and r.source_excerpt like '%在留期限を無期限%';
  if n_hsp2 <> 1 then
    raise exception 'The unlimited period of residence on Highly Skilled Professional Type 2 is missing';
  end if;

  -- THE PERIODS OF STAY DIFFER AND MUST NOT BE FLATTENED.
  select count(*) into n_periods from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'JP' and r.requirement_code like 'period_of_stay%';
  if n_periods < 9 then
    raise exception 'Period-of-stay rows are missing from Japanese routes: % found', n_periods;
  end if;
  if (select source_excerpt from public.visa_requirements r join public.visa_types t on t.id = r.visa_type_id
       where t.visaai_id = 'jp-business-manager' and r.requirement_code = 'period_of_stay')
     = (select source_excerpt from public.visa_requirements r join public.visa_types t on t.id = r.visa_type_id
         where t.visaai_id = 'jp-researcher' and r.requirement_code = 'period_of_stay') then
    raise exception 'Business Manager and Researcher periods of stay have been flattened to the same text';
  end if;

  -- NURSING CARE: the qualification itself, and what the 2020 change did.
  select count(*) into n_care from public.visa_requirements r
   where r.requirement_code = 'route_to_the_qualification_no_longer_matters'
     and (r.parameters->>'changed_on') = '2020-04-01';
  if n_care <> 1 then
    raise exception 'The 1 April 2020 nursing-care change is missing or misdated';
  end if;

  -- MOFA refuses our monitor and must never be registered.
  if exists (select 1 from public.visa_sources s join public.visa_countries c on c.id = s.country_id
              where c.code = 'JP' and s.source_url like '%mofa.go.jp%') then
    raise exception 'www.mofa.go.jp returns 403 on robots.txt and must not be registered';
  end if;

  raise notice 'Japan live: % requirements active across % routes', n_active, n_types;
end $$;
