-- Denmark goes live: 10 routes, 295 requirements, across two agencies.
--
-- Every assertion below guards a clause whose loss would NOT look like a loss.
-- The page would still read as a complete, confident requirement — and would be
-- wrong in the direction that costs someone a refused application, a fee, or a
-- permit they already hold.
--
--   THE FIVE NATIONALITY GROUPS MUST ALL SURVIVE. Denmark sorts visa-required
--   countries into five groups, and the group decides what relationship to a
--   host is needed before a visa is granted at all: group 1 travels as a pure
--   tourist with no host, group 3 normally needs a close family member, group 4
--   is narrowed to spouse/partner/minor child/parent, group 5 needs extenuating
--   circumstances. Any single "you need a host" or "tourists are welcome"
--   sentence is false for four of the five. This is the Singapore V39A shape —
--   19 nationalities need a sponsor's form and 14 do not — and it is the single
--   most dangerous flattening available on the visa page.
--
--   THE GROUPING CAVEAT TRAVELS WITH THE GROUPS. The authority states the
--   division "serves only as a rough guideline" and that every application is
--   decided case by case. Publishing the groups without it presents a schedule
--   of entitlements the authority explicitly declined to give.
--
--   THE EMPLOYER'S APPRENTICESHIP OBLIGATION, AND THAT IT CANNOT BE WAIVED. A
--   Positive List for Skilled Work permit depends on the EMPLOYER having met its
--   Læreplads-AUB training obligations — a condition about the company that the
--   applicant cannot satisfy and usually cannot see. The authority answers in
--   its own FAQ that no exemption is possible. Without that answer, a
--   partially-compliant employer reads as an argument worth making.
--
--   TWO OF FOUR SUPPLEMENTARY REQUIREMENTS, OR THE BASIC LIST IS A LIE. Denmark
--   requires at least two of four supplementary requirements for permanent
--   residence, and all four to qualify after four years instead of eight.
--   Publishing the basic requirements alone tells a reader they qualify when
--   they do not.
--
--   THE STUDENTS WHO MAY NOT WORK AT ALL. A student on a non-state-approved
--   programme who applied on or after 2 May 2025 gets no work permit and no
--   right to work. The 90-hours-a-month figure is real for everyone else, and
--   publishing it as "the student work rule" would tell that group to commit
--   what the authority calls illegal work.
--
--   THE SPONSOR'S MANDATORY DANISH CONDITION. Prøve i Dansk 3 or five years of
--   employment with significant Danish communication is required REGARDLESS of
--   the 4-of-6 integration score. A couple can satisfy four of six and still be
--   refused on it.
--
--   THE TWO FAST-TRACK CONDITIONS NOBODY CONTROLS. The supplementary pay limit
--   track requires that national gross unemployment not have exceeded 3.75 per
--   cent, and that the job was advertised on Jobnet AND EURES for two weeks
--   before applying — with the authority stating flatly that other portals do
--   not count. Both can fail an otherwise perfect application, and neither can
--   be fixed afterwards.
--
--   THE PASSPORT RULE IS WORDED DIFFERENTLY PER ROUTE. Researchers: "90 days"
--   before passport expiry. Pay Limit and Positive List: "3 months". They are
--   not the same span and neither is quoted in place of the other.
--
--   THE SECOND PERMANENT-RESIDENCE FEE. DKK 7,570 for work and study
--   applicants, DKK 4,970 for family reunification and asylum. Publishing only
--   the first overstates the cost by DKK 2,600 for the people least able to
--   absorb it.

update public.visa_requirements r
   set status = 'active', last_verified_at = '2026-08-26'::timestamptz
  from public.visa_types t
  join public.visa_countries c on c.id = t.country_id
 where t.id = r.visa_type_id
   and c.code = 'DK'
   and r.status = 'draft';

update public.visa_types t
   set data_quality = 'verified', last_verified_at = '2026-08-26'::timestamptz
  from public.visa_countries c
 where c.id = t.country_id and c.code = 'DK'
   and exists (select 1 from public.visa_requirements r
                where r.visa_type_id = t.id and r.status = 'active');

update public.visa_countries
   set support_state = 'supported',
       fee_currency  = 'DKK',
       data_quality  = 'verified',
       last_verified_at = '2026-08-26'::timestamptz
 where code = 'DK';

do $$
declare
  n_active integer; n_bad integer; n_pages integer; n_heading integer;
  n_groups integer; n_caveat integer; n_appr integer; n_supp integer;
  n_nowork integer; n_danish integer; n_unemp integer; n_jobnet integer;
  n_portals integer; n_90 integer; n_3m integer; n_fees integer; n_paylimits integer;
  n_state text;
begin
  select count(*) into n_active from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'DK' and r.status = 'active';
  if n_active <> 295 then raise exception 'Expected 295 active DK requirements, found %', n_active; end if;

  select count(*) into n_bad from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'DK' and r.status = 'active'
     and (r.source_version_id is null or r.source_excerpt is null or r.source_excerpt_display is null);
  if n_bad > 0 then raise exception '% DK requirement(s) lack provenance or a display quotation', n_bad; end if;

  -- The display quotation must lowercase EXACTLY to the matching excerpt. That
  -- correspondence is what makes the pair a quotation rather than two separate
  -- matches, and it is what deriveDisplayExcerpt exists to preserve.
  select count(*) into n_bad from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'DK' and r.status = 'active'
     and lower(r.source_excerpt_display) <> r.source_excerpt;
  if n_bad > 0 then
    raise exception '% DK display quotation(s) do not lowercase to their excerpt', n_bad;
  end if;

  select count(*) into n_heading from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'DK' and r.status = 'active'
     and r.source_excerpt like '%:' and length(r.source_excerpt) <= 100
     and r.source_excerpt !~* '(must|need|require|should|may|shall|will|are|is|allowed|permitted|granted|exempt|at least|one of|either|you|holder)';
  if n_heading > 0 then
    raise exception '% DK requirement(s) quote a section HEADING as their evidence', n_heading;
  end if;

  -- All five nationality groups, each with its own rule.
  select count(*) into n_groups from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'dk-short-stay-visa' and r.status = 'active'
     and r.requirement_code in ('group_1_rule','group_2_rule','group_3_rule','group_4_rule','group_5_rule');
  if n_groups <> 5 then
    raise exception 'All 5 Danish nationality groups must be published separately; found %', n_groups;
  end if;

  select count(*) into n_caveat from public.visa_requirements r
   where r.status = 'active' and r.requirement_code = 'grouping_is_a_guideline_only'
     and r.source_excerpt like '%rough guideline%';
  if n_caveat <> 1 then
    raise exception 'The "rough guideline" caveat must travel with the five groups; found %', n_caveat;
  end if;

  -- The employer condition, and that it admits no exemption.
  select count(*) into n_appr from public.visa_requirements r
   where r.status = 'active'
     and r.requirement_code = 'employer_educational_obligation_no_exemption'
     and r.source_excerpt like '%not possible to make exemptions%';
  if n_appr <> 1 then
    raise exception 'The no-exemption answer on the employer training obligation must be published; found %', n_appr;
  end if;

  select count(*) into n_supp from public.visa_requirements r
   where r.status = 'active' and r.requirement_code = 'two_of_four_supplementary_required'
     and r.source_excerpt like '%at least 2 of 4 supplementary requirements%';
  if n_supp <> 1 then
    raise exception 'The 2-of-4 supplementary rule must be published with the basic requirements; found %', n_supp;
  end if;

  select count(*) into n_nowork from public.visa_requirements r
   where r.status = 'active'
     and r.requirement_code = 'no_work_rights_non_state_approved_after_may_2025'
     and r.source_excerpt like '%2 may 2025%'
     and r.source_excerpt like '%do not have the right to work%';
  if n_nowork <> 1 then
    raise exception 'The students with NO right to work must be named, with their commencement date; found %', n_nowork;
  end if;

  select count(*) into n_danish from public.visa_requirements r
   where r.status = 'active' and r.requirement_code = 'sponsor_mandatory_danish_condition'
     and r.source_excerpt like '%mandatory condition%';
  if n_danish <> 1 then
    raise exception 'The sponsor mandatory Danish condition must survive the 4-of-6 score; found %', n_danish;
  end if;

  select count(*) into n_unemp from public.visa_requirements r
   where r.status = 'active' and r.requirement_code = 'supplementary_track_unemployment_ceiling'
     and r.source_excerpt like '%3.75 pct%';
  select count(*) into n_jobnet from public.visa_requirements r
   where r.status = 'active' and r.requirement_code = 'supplementary_track_job_posting'
     and r.source_excerpt like '%jobnet and the eures portal%';
  select count(*) into n_portals from public.visa_requirements r
   where r.status = 'active' and r.requirement_code = 'supplementary_track_other_portals_do_not_count';
  if n_unemp <> 1 or n_jobnet <> 1 or n_portals <> 1 then
    raise exception
      'The supplementary Fast-Track conditions must all be published (unemployment %, jobnet %, other-portals %)',
      n_unemp, n_jobnet, n_portals;
  end if;

  -- The passport rule, quoted as each page words it.
  select count(*) into n_90 from public.visa_requirements r
   where r.status='active' and r.requirement_code='passport_shortens_permit_90_days'
     and r.source_excerpt like '%90 days before the expiry date%';
  select count(*) into n_3m from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code='DK' and r.status='active' and r.requirement_code='passport_shortens_permit'
     and r.source_excerpt like '%3 months before the expiry date%';
  if n_90 <> 1 or n_3m < 2 then
    raise exception
      'The passport rule must be quoted as each page words it: 90-days %, 3-months %', n_90, n_3m;
  end if;

  -- Both permanent-residence fees.
  select count(*) into n_fees from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'dk-permanent-residence' and r.status='active' and r.kind = 'fee';
  if n_fees <> 2 then
    raise exception 'Permanent residence has TWO fees (7,570 and 4,970); found % fee requirement(s)', n_fees;
  end if;

  -- The two Fast-Track pay limits must stay distinct.
  select count(*) into n_paylimits from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'dk-fast-track-scheme' and r.status='active'
     and r.requirement_code in ('pay_limit_track_salary','supplementary_track_salary')
     and (r.source_excerpt like '%552,000%' or r.source_excerpt like '%446,000%');
  if n_paylimits <> 2 then
    raise exception 'Both Fast-Track pay limits must be published distinctly; found %', n_paylimits;
  end if;

  select support_state into n_state from public.visa_countries where code = 'DK';
  if n_state <> 'supported' then raise exception 'Denmark should be supported, found %', n_state; end if;

  select count(*) into n_pages from public.visa_publishable_pages where country_code = 'DK';
  if n_pages <> 10 then raise exception 'Denmark should publish 10 pages, found %', n_pages; end if;

  raise notice 'Denmark LIVE: 10 routes, % requirements, 7 SIRI / 3 Immigration Service.', n_active;
end $$;
