-- Rollback for 20261019120000 / 20261019120100 / 20261019120200 (Express Entry documents v2).
--
-- Restores the 17 requirements exactly as extracted in
-- data/requirements/ca-express-entry.json at origin/main before this change
-- (re-generated from that file below -- documents_to_get_ready goes back to
-- `evidence`), retires the nine document rows v2 added, and re-activates.
-- The `documents` visa_sources row is left in place: its version is referenced
-- by the retired rows (FK RESTRICT) and an unused source is harmless;
-- deactivate it by hand if wanted.
--
-- Apply: docker exec -i selfhosted_db psql -U supabase_admin -d postgres -1 < this file
-- Requirements for ca-express-entry, extracted 2026-08-21.
--
-- GENERATED FILE. Do not hand-edit.
--   source: data/requirements/ca-express-entry.json @ origin/main (pre-v2)
--   generator: scripts/visa-registry/generate-requirements.mjs
--   method: manual
--
-- Every row below quotes the official page it was read from, and binds to
-- that source's ACTIVE version via subquery rather than a pasted uuid — so
-- if the page moved since extraction, the requirement attaches to what is
-- actually live and the sync's change queue catches the drift.
--
-- Rows are inserted as DRAFT. Promotion to 'active' is a separate step,
-- because that is the step where a person takes responsibility for the claim.
--
-- DELIBERATELY NOT EXTRACTED:
--   * Express Entry is not one program. It is an application-management system for three: the Canadian Experience Class, the Federal Skilled Worker Program and the Federal Skilled Trades Program, each with its own criteria. IRCC publishes those criteria as a side-by-side comparison, so each eligibility requirement below quotes all three columns and names the program each rule belongs to in its own text. None carries a machine rule: VisaAI has no fact for which of the three programs an applicant is pursuing, and gating on a guess would silently hide the criteria that actually apply to them.
--   * The Comprehensive Ranking System points formula. Meeting the minimum criteria only puts a candidate in the pool; IRCC selects by score, and the scoring tables are on a separate 'check your score' page that is not a registered source.
--   * The cut-off score for any round of invitations. IRCC publishes those per round on a separate page.
--   * Full eligibility detail for each of the three programs. Each has its own page (canadian experience class, federal skilled worker program, federal skilled trades program) linked from the navigation but not registered as a source. Only the comparison table on works.html was read.
--   * The Federal Skilled Trades Program's full NOC group list beyond the lead-in. IRCC names major groups 72, 73, 82, 83, 92 and 93, minor group 6320 and unit group 62200, with exclusions for sub-major groups 726 and 932; those are recorded in the requirement description rather than turned into rules, because VisaAI has no NOC fact.
--   * Settlement-funds amounts. IRCC's landing page names 'funds' among the documents to get ready but publishes no threshold on either page read; the amounts live on the get-your-documents-ready page, which is not a registered source.
--   * Language test, education assessment, job offer and police certificate specifics. Same reason — the landing page names the categories, the detail is on a page that is not a registered source.
--   * Provincial Nominee Program eligibility. IRCC states a nomination gives extra points, but PNP criteria are set by each province and published elsewhere.
--   * Fees as shown on the Express Entry landing page. Its fee widget failed server-side at read time — it renders 'your application: [error loading fee. check the fee list .]' — so all amounts below come from the fee list instead.
--   * A biometrics fee for Express Entry. The landing page states biometrics are part of the after-you-apply stage, but the fee list's biometrics section qualifies the requirement as applying when you apply for 'a visitor visa, study permit or work permit'. That sentence does not cover a permanent residence application, so no biometrics fee is claimed here.
--   * Processing times. The landing page says only 'varies by program'.

begin;

insert into public.visa_requirements (
  visa_type_id, requirement_code, kind, officially_required, label, description,
  official_form_code, official_form_url, rule, parameters,
  source_version_id, source_excerpt, source_excerpt_display, extraction_method, confidence,
  status, display_order, last_verified_at
) values (
  (select id from public.visa_types where visaai_id = 'ca-express-entry'),
  'three_express_entry_programs', 'condition', true,
  'You must qualify for one of the three programs Express Entry manages', 'Canadian Experience Class — for skilled workers with eligible Canadian work experience. Federal Skilled Worker Program — for skilled workers with eligible foreign or Canadian work experience. Federal Skilled Trades Program — for skilled workers qualified in a skilled trade.',
  null, null,
  null, '{}'::jsonb,
  -- Scoped to THIS visa type, not just the URL. Since
  -- 20260820160000 a shared government page has one visa_sources row per visa
  -- type it serves — GOV.UK's Standard Visitor page covers both the general
  -- and the business-visit entries — so matching on source_url alone returns
  -- two active versions and the subquery errors with "more than one row".
  --
  -- The limit 1 after the visa-type filter is belt-and-braces: the partial unique
  -- index already allows one active version per source, so the filter alone is
  -- sufficient, but a country-level source (visa_type_id null) shared with a
  -- typed one would otherwise still be ambiguous.
  (select v.id from public.visa_source_versions v
     join public.visa_sources s on s.id = v.source_id
    where s.source_url = 'https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry/works.html'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'ca-express-entry'))
    order by s.visa_type_id nulls last
    limit 1),
  'express entry is an online system that we use to manage immigration applications for 3 programs: canadian experience class for skilled workers with eligible canadian work experience federal skilled worker program for skilled workers with eligible foreign or canadian work experience federal skilled trades program for skilled workers who are qualified in a skilled trade', 'Express Entry is an online system that we use to manage immigration applications for 3 programs: Canadian Experience Class For skilled workers with eligible Canadian work experience Federal Skilled Worker Program For skilled workers with eligible foreign or Canadian work experience Federal Skilled Trades Program For skilled workers who are qualified in a skilled trade', 'manual', 1.00,
  'draft', 10, '2026-08-21'::timestamptz
)
on conflict (visa_type_id, requirement_code) where status <> 'retired'
do update set
  kind = excluded.kind,
  officially_required = excluded.officially_required,
  label = excluded.label,
  description = excluded.description,
  official_form_code = excluded.official_form_code,
  official_form_url = excluded.official_form_url,
  rule = excluded.rule,
  parameters = excluded.parameters,
  source_version_id = excluded.source_version_id,
  source_excerpt = excluded.source_excerpt,
  source_excerpt_display = excluded.source_excerpt_display,
  last_verified_at = excluded.last_verified_at,
  -- DEMOTE ON CHANGE. Without this clause, re-running an extraction silently
  -- rewrote the label, rule and excerpt of an ALREADY-REVIEWED requirement
  -- while leaving it 'active', so an edit to the extraction file reached
  -- applicants without anyone re-reading it. That is the same failure the
  -- sync's promotion queue exists to prevent, one layer down.
  --
  -- Any change to what the requirement CLAIMS sends it back to draft. A re-run
  -- that confirms the same text touches only last_verified_at and leaves the
  -- review intact, which is what re-verification should do.
  status = case
    when public.visa_requirements.kind is distinct from excluded.kind
      or public.visa_requirements.officially_required is distinct from excluded.officially_required
      or public.visa_requirements.label is distinct from excluded.label
      or public.visa_requirements.description is distinct from excluded.description
      or public.visa_requirements.official_form_code is distinct from excluded.official_form_code
      or public.visa_requirements.rule is distinct from excluded.rule
      or public.visa_requirements.parameters is distinct from excluded.parameters
      or public.visa_requirements.source_excerpt is distinct from excluded.source_excerpt
    then 'draft'
    else public.visa_requirements.status
  end;

insert into public.visa_requirements (
  visa_type_id, requirement_code, kind, officially_required, label, description,
  official_form_code, official_form_url, rule, parameters,
  source_version_id, source_excerpt, source_excerpt_display, extraction_method, confidence,
  status, display_order, last_verified_at
) values (
  (select id from public.visa_types where visaai_id = 'ca-express-entry'),
  'language_ability', 'condition', true,
  'Meet the language ability threshold for your program', 'Measured on the Canadian Language Benchmark (CLB), the Canadian standard for measuring an immigrant''s English language ability. Canadian Experience Class: CLB 7 for TEER 0 or TEER 1 occupations, CLB 5 for TEER 2 or TEER 3. Federal Skilled Worker Program: CLB 7. Federal Skilled Trades Program: CLB 5 for speaking and listening, CLB 4 for reading and writing.',
  null, null,
  null, '{}'::jsonb,
  -- Scoped to THIS visa type, not just the URL. Since
  -- 20260820160000 a shared government page has one visa_sources row per visa
  -- type it serves — GOV.UK's Standard Visitor page covers both the general
  -- and the business-visit entries — so matching on source_url alone returns
  -- two active versions and the subquery errors with "more than one row".
  --
  -- The limit 1 after the visa-type filter is belt-and-braces: the partial unique
  -- index already allows one active version per source, so the filter alone is
  -- sufficient, but a country-level source (visa_type_id null) shared with a
  -- typed one would otherwise still be ambiguous.
  (select v.id from public.visa_source_versions v
     join public.visa_sources s on s.id = v.source_id
    where s.source_url = 'https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry/works.html'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'ca-express-entry'))
    order by s.visa_type_id nulls last
    limit 1),
  'language skills canadian experience class clb 7 for teer 0 or teer 1 occupations clb 5 for teer 2 or teer 3 occupations federal skilled worker program clb 7 federal skilled trades program clb 5 for speaking and listening clb 4 for reading and writing', 'Language skills Canadian Experience Class CLB 7 for TEER 0 or TEER 1 occupations CLB 5 for TEER 2 or TEER 3 occupations Federal Skilled Worker Program CLB 7 Federal Skilled Trades Program CLB 5 for speaking and listening CLB 4 for reading and writing', 'manual', 1.00,
  'draft', 20, '2026-08-21'::timestamptz
)
on conflict (visa_type_id, requirement_code) where status <> 'retired'
do update set
  kind = excluded.kind,
  officially_required = excluded.officially_required,
  label = excluded.label,
  description = excluded.description,
  official_form_code = excluded.official_form_code,
  official_form_url = excluded.official_form_url,
  rule = excluded.rule,
  parameters = excluded.parameters,
  source_version_id = excluded.source_version_id,
  source_excerpt = excluded.source_excerpt,
  source_excerpt_display = excluded.source_excerpt_display,
  last_verified_at = excluded.last_verified_at,
  -- DEMOTE ON CHANGE. Without this clause, re-running an extraction silently
  -- rewrote the label, rule and excerpt of an ALREADY-REVIEWED requirement
  -- while leaving it 'active', so an edit to the extraction file reached
  -- applicants without anyone re-reading it. That is the same failure the
  -- sync's promotion queue exists to prevent, one layer down.
  --
  -- Any change to what the requirement CLAIMS sends it back to draft. A re-run
  -- that confirms the same text touches only last_verified_at and leaves the
  -- review intact, which is what re-verification should do.
  status = case
    when public.visa_requirements.kind is distinct from excluded.kind
      or public.visa_requirements.officially_required is distinct from excluded.officially_required
      or public.visa_requirements.label is distinct from excluded.label
      or public.visa_requirements.description is distinct from excluded.description
      or public.visa_requirements.official_form_code is distinct from excluded.official_form_code
      or public.visa_requirements.rule is distinct from excluded.rule
      or public.visa_requirements.parameters is distinct from excluded.parameters
      or public.visa_requirements.source_excerpt is distinct from excluded.source_excerpt
    then 'draft'
    else public.visa_requirements.status
  end;

insert into public.visa_requirements (
  visa_type_id, requirement_code, kind, officially_required, label, description,
  official_form_code, official_form_url, rule, parameters,
  source_version_id, source_excerpt, source_excerpt_display, extraction_method, confidence,
  status, display_order, last_verified_at
) values (
  (select id from public.visa_types where visaai_id = 'ca-express-entry'),
  'type_of_work_experience', 'condition', true,
  'Hold the type of work experience your program requires', 'Occupations are classified by the National Occupational Classification (NOC), whose six TEER categories are based on the education and training an occupation needs. Canadian Experience Class: Canadian work experience in an occupation in TEER 0, 1, 2 or 3. Federal Skilled Worker Program: work experience in an occupation in one of TEER 0, 1, 2 or 3. Federal Skilled Trades Program: work experience in a skilled trade under key groups of TEER 2 or 3 — major group 72 (technical trades and transportation officers and controllers, excluding sub-major group 726), major group 73 (general trades), major group 82, major group 83, major group 92, major group 93 (excluding sub-major group 932), minor group 6320 (cooks, butchers and bakers) and unit group 62200 (chefs).',
  null, null,
  null, '{}'::jsonb,
  -- Scoped to THIS visa type, not just the URL. Since
  -- 20260820160000 a shared government page has one visa_sources row per visa
  -- type it serves — GOV.UK's Standard Visitor page covers both the general
  -- and the business-visit entries — so matching on source_url alone returns
  -- two active versions and the subquery errors with "more than one row".
  --
  -- The limit 1 after the visa-type filter is belt-and-braces: the partial unique
  -- index already allows one active version per source, so the filter alone is
  -- sufficient, but a country-level source (visa_type_id null) shared with a
  -- typed one would otherwise still be ambiguous.
  (select v.id from public.visa_source_versions v
     join public.visa_sources s on s.id = v.source_id
    where s.source_url = 'https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry/works.html'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'ca-express-entry'))
    order by s.visa_type_id nulls last
    limit 1),
  'type of work experience canadian experience class canadian work experience in an occupation listed in 1 or more of these noc teer categories: teer 0 teer 1 teer 2 teer 3 federal skilled worker program work experience in an occupation listed in 1 of these noc teer categories: teer 0 teer 1 teer 2 teer 3 federal skilled trades program work experience in a skilled trade under key groups of teer 2 or teer 3:', 'Type of work experience Canadian Experience Class Canadian work experience in an occupation listed in 1 or more of these NOC TEER Categories: TEER 0 TEER 1 TEER 2 TEER 3 Federal Skilled Worker Program Work experience in an occupation listed in 1 of these NOC TEER Categories: TEER 0 TEER 1 TEER 2 TEER 3 Federal Skilled Trades Program Work experience in a skilled trade under key groups of TEER 2 or TEER 3:', 'manual', 1.00,
  'draft', 30, '2026-08-21'::timestamptz
)
on conflict (visa_type_id, requirement_code) where status <> 'retired'
do update set
  kind = excluded.kind,
  officially_required = excluded.officially_required,
  label = excluded.label,
  description = excluded.description,
  official_form_code = excluded.official_form_code,
  official_form_url = excluded.official_form_url,
  rule = excluded.rule,
  parameters = excluded.parameters,
  source_version_id = excluded.source_version_id,
  source_excerpt = excluded.source_excerpt,
  source_excerpt_display = excluded.source_excerpt_display,
  last_verified_at = excluded.last_verified_at,
  -- DEMOTE ON CHANGE. Without this clause, re-running an extraction silently
  -- rewrote the label, rule and excerpt of an ALREADY-REVIEWED requirement
  -- while leaving it 'active', so an edit to the extraction file reached
  -- applicants without anyone re-reading it. That is the same failure the
  -- sync's promotion queue exists to prevent, one layer down.
  --
  -- Any change to what the requirement CLAIMS sends it back to draft. A re-run
  -- that confirms the same text touches only last_verified_at and leaves the
  -- review intact, which is what re-verification should do.
  status = case
    when public.visa_requirements.kind is distinct from excluded.kind
      or public.visa_requirements.officially_required is distinct from excluded.officially_required
      or public.visa_requirements.label is distinct from excluded.label
      or public.visa_requirements.description is distinct from excluded.description
      or public.visa_requirements.official_form_code is distinct from excluded.official_form_code
      or public.visa_requirements.rule is distinct from excluded.rule
      or public.visa_requirements.parameters is distinct from excluded.parameters
      or public.visa_requirements.source_excerpt is distinct from excluded.source_excerpt
    then 'draft'
    else public.visa_requirements.status
  end;

insert into public.visa_requirements (
  visa_type_id, requirement_code, kind, officially_required, label, description,
  official_form_code, official_form_url, rule, parameters,
  source_version_id, source_excerpt, source_excerpt_display, extraction_method, confidence,
  status, display_order, last_verified_at
) values (
  (select id from public.visa_types where visaai_id = 'ca-express-entry'),
  'amount_of_work_experience', 'condition', true,
  'Hold the amount of work experience your program requires', 'Canadian Experience Class: 1 year in Canada in the last 3 years, in any combination of full-time or part-time work. Federal Skilled Worker Program: 1 year continuous within the last 10 years, which may combine part-time, full-time or more than one job in your primary occupation. Federal Skilled Trades Program: 2 years within the last 5 years, in any combination of full-time or part-time work.',
  null, null,
  null, '{}'::jsonb,
  -- Scoped to THIS visa type, not just the URL. Since
  -- 20260820160000 a shared government page has one visa_sources row per visa
  -- type it serves — GOV.UK's Standard Visitor page covers both the general
  -- and the business-visit entries — so matching on source_url alone returns
  -- two active versions and the subquery errors with "more than one row".
  --
  -- The limit 1 after the visa-type filter is belt-and-braces: the partial unique
  -- index already allows one active version per source, so the filter alone is
  -- sufficient, but a country-level source (visa_type_id null) shared with a
  -- typed one would otherwise still be ambiguous.
  (select v.id from public.visa_source_versions v
     join public.visa_sources s on s.id = v.source_id
    where s.source_url = 'https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry/works.html'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'ca-express-entry'))
    order by s.visa_type_id nulls last
    limit 1),
  'amount of work experience canadian experience class 1 year in canada in the last 3 years (either combination of full-time or part-time work) federal skilled worker program 1 year continuous within the last 10 years (combination of part-time, full-time or more than 1 job in your primary occupation ) federal skilled trades program 2 years within the last 5 years (either combination of full-time or part-time work)', 'Amount of work experience Canadian Experience Class 1 year in Canada in the last 3 years (either combination of full-time or part-time work) Federal Skilled Worker Program 1 year continuous within the last 10 years (combination of part-time, full-time or more than 1 job in your primary occupation) Federal Skilled Trades Program 2 years within the last 5 years (either combination of full-time or part-time work)', 'manual', 1.00,
  'draft', 40, '2026-08-21'::timestamptz
)
on conflict (visa_type_id, requirement_code) where status <> 'retired'
do update set
  kind = excluded.kind,
  officially_required = excluded.officially_required,
  label = excluded.label,
  description = excluded.description,
  official_form_code = excluded.official_form_code,
  official_form_url = excluded.official_form_url,
  rule = excluded.rule,
  parameters = excluded.parameters,
  source_version_id = excluded.source_version_id,
  source_excerpt = excluded.source_excerpt,
  source_excerpt_display = excluded.source_excerpt_display,
  last_verified_at = excluded.last_verified_at,
  -- DEMOTE ON CHANGE. Without this clause, re-running an extraction silently
  -- rewrote the label, rule and excerpt of an ALREADY-REVIEWED requirement
  -- while leaving it 'active', so an edit to the extraction file reached
  -- applicants without anyone re-reading it. That is the same failure the
  -- sync's promotion queue exists to prevent, one layer down.
  --
  -- Any change to what the requirement CLAIMS sends it back to draft. A re-run
  -- that confirms the same text touches only last_verified_at and leaves the
  -- review intact, which is what re-verification should do.
  status = case
    when public.visa_requirements.kind is distinct from excluded.kind
      or public.visa_requirements.officially_required is distinct from excluded.officially_required
      or public.visa_requirements.label is distinct from excluded.label
      or public.visa_requirements.description is distinct from excluded.description
      or public.visa_requirements.official_form_code is distinct from excluded.official_form_code
      or public.visa_requirements.rule is distinct from excluded.rule
      or public.visa_requirements.parameters is distinct from excluded.parameters
      or public.visa_requirements.source_excerpt is distinct from excluded.source_excerpt
    then 'draft'
    else public.visa_requirements.status
  end;

insert into public.visa_requirements (
  visa_type_id, requirement_code, kind, officially_required, label, description,
  official_form_code, official_form_url, rule, parameters,
  source_version_id, source_excerpt, source_excerpt_display, extraction_method, confidence,
  status, display_order, last_verified_at
) values (
  (select id from public.visa_types where visaai_id = 'ca-express-entry'),
  'job_offer', 'condition', true,
  'Job offer — required only for the Federal Skilled Trades Program', 'Canadian Experience Class: not required. Federal Skilled Worker Program: not required, but a valid job offer earns selection criteria points. Federal Skilled Trades Program: required — either a valid job offer of full-time employment for a total period of at least 1 year, or a certificate of qualification in the skilled trade issued by a Canadian provincial, territorial or federal authority.',
  null, null,
  null, '{}'::jsonb,
  -- Scoped to THIS visa type, not just the URL. Since
  -- 20260820160000 a shared government page has one visa_sources row per visa
  -- type it serves — GOV.UK's Standard Visitor page covers both the general
  -- and the business-visit entries — so matching on source_url alone returns
  -- two active versions and the subquery errors with "more than one row".
  --
  -- The limit 1 after the visa-type filter is belt-and-braces: the partial unique
  -- index already allows one active version per source, so the filter alone is
  -- sufficient, but a country-level source (visa_type_id null) shared with a
  -- typed one would otherwise still be ambiguous.
  (select v.id from public.visa_source_versions v
     join public.visa_sources s on s.id = v.source_id
    where s.source_url = 'https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry/works.html'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'ca-express-entry'))
    order by s.visa_type_id nulls last
    limit 1),
  'job offer canadian experience class not required. federal skilled worker program not required, but you can get selection criteria points for having a valid job offer. federal skilled trades program required: a valid job offer of full-time employment for a total period of at least 1 year, or a certificate of qualification in the above skilled trade issued by a canadian provincial, territorial or federal authority', 'Job offer Canadian Experience Class Not required. Federal Skilled Worker Program Not required, but you can get selection criteria points for having a valid job offer. Federal Skilled Trades Program Required: a valid job offer of full-time employment for a total period of at least 1 year, or a certificate of qualification in the above skilled trade issued by a Canadian provincial, territorial or federal authority', 'manual', 1.00,
  'draft', 50, '2026-08-21'::timestamptz
)
on conflict (visa_type_id, requirement_code) where status <> 'retired'
do update set
  kind = excluded.kind,
  officially_required = excluded.officially_required,
  label = excluded.label,
  description = excluded.description,
  official_form_code = excluded.official_form_code,
  official_form_url = excluded.official_form_url,
  rule = excluded.rule,
  parameters = excluded.parameters,
  source_version_id = excluded.source_version_id,
  source_excerpt = excluded.source_excerpt,
  source_excerpt_display = excluded.source_excerpt_display,
  last_verified_at = excluded.last_verified_at,
  -- DEMOTE ON CHANGE. Without this clause, re-running an extraction silently
  -- rewrote the label, rule and excerpt of an ALREADY-REVIEWED requirement
  -- while leaving it 'active', so an edit to the extraction file reached
  -- applicants without anyone re-reading it. That is the same failure the
  -- sync's promotion queue exists to prevent, one layer down.
  --
  -- Any change to what the requirement CLAIMS sends it back to draft. A re-run
  -- that confirms the same text touches only last_verified_at and leaves the
  -- review intact, which is what re-verification should do.
  status = case
    when public.visa_requirements.kind is distinct from excluded.kind
      or public.visa_requirements.officially_required is distinct from excluded.officially_required
      or public.visa_requirements.label is distinct from excluded.label
      or public.visa_requirements.description is distinct from excluded.description
      or public.visa_requirements.official_form_code is distinct from excluded.official_form_code
      or public.visa_requirements.rule is distinct from excluded.rule
      or public.visa_requirements.parameters is distinct from excluded.parameters
      or public.visa_requirements.source_excerpt is distinct from excluded.source_excerpt
    then 'draft'
    else public.visa_requirements.status
  end;

insert into public.visa_requirements (
  visa_type_id, requirement_code, kind, officially_required, label, description,
  official_form_code, official_form_url, rule, parameters,
  source_version_id, source_excerpt, source_excerpt_display, extraction_method, confidence,
  status, display_order, last_verified_at
) values (
  (select id from public.visa_types where visaai_id = 'ca-express-entry'),
  'education', 'condition', true,
  'Education — required only for the Federal Skilled Worker Program', 'Canadian Experience Class: not required. Federal Skilled Worker Program: secondary education required, with more selection criteria points available for post-secondary education. Federal Skilled Trades Program: not required.',
  null, null,
  null, '{}'::jsonb,
  -- Scoped to THIS visa type, not just the URL. Since
  -- 20260820160000 a shared government page has one visa_sources row per visa
  -- type it serves — GOV.UK's Standard Visitor page covers both the general
  -- and the business-visit entries — so matching on source_url alone returns
  -- two active versions and the subquery errors with "more than one row".
  --
  -- The limit 1 after the visa-type filter is belt-and-braces: the partial unique
  -- index already allows one active version per source, so the filter alone is
  -- sufficient, but a country-level source (visa_type_id null) shared with a
  -- typed one would otherwise still be ambiguous.
  (select v.id from public.visa_source_versions v
     join public.visa_sources s on s.id = v.source_id
    where s.source_url = 'https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry/works.html'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'ca-express-entry'))
    order by s.visa_type_id nulls last
    limit 1),
  'education canadian experience class not required. federal skilled worker program secondary education required. you can get more selection criteria points for your post-secondary education. federal skilled trades program not required.', 'Education Canadian Experience Class Not required. Federal Skilled Worker Program Secondary education required. You can get more selection criteria points for your post-secondary education. Federal Skilled Trades Program Not required.', 'manual', 1.00,
  'draft', 60, '2026-08-21'::timestamptz
)
on conflict (visa_type_id, requirement_code) where status <> 'retired'
do update set
  kind = excluded.kind,
  officially_required = excluded.officially_required,
  label = excluded.label,
  description = excluded.description,
  official_form_code = excluded.official_form_code,
  official_form_url = excluded.official_form_url,
  rule = excluded.rule,
  parameters = excluded.parameters,
  source_version_id = excluded.source_version_id,
  source_excerpt = excluded.source_excerpt,
  source_excerpt_display = excluded.source_excerpt_display,
  last_verified_at = excluded.last_verified_at,
  -- DEMOTE ON CHANGE. Without this clause, re-running an extraction silently
  -- rewrote the label, rule and excerpt of an ALREADY-REVIEWED requirement
  -- while leaving it 'active', so an edit to the extraction file reached
  -- applicants without anyone re-reading it. That is the same failure the
  -- sync's promotion queue exists to prevent, one layer down.
  --
  -- Any change to what the requirement CLAIMS sends it back to draft. A re-run
  -- that confirms the same text touches only last_verified_at and leaves the
  -- review intact, which is what re-verification should do.
  status = case
    when public.visa_requirements.kind is distinct from excluded.kind
      or public.visa_requirements.officially_required is distinct from excluded.officially_required
      or public.visa_requirements.label is distinct from excluded.label
      or public.visa_requirements.description is distinct from excluded.description
      or public.visa_requirements.official_form_code is distinct from excluded.official_form_code
      or public.visa_requirements.rule is distinct from excluded.rule
      or public.visa_requirements.parameters is distinct from excluded.parameters
      or public.visa_requirements.source_excerpt is distinct from excluded.source_excerpt
    then 'draft'
    else public.visa_requirements.status
  end;

insert into public.visa_requirements (
  visa_type_id, requirement_code, kind, officially_required, label, description,
  official_form_code, official_form_url, rule, parameters,
  source_version_id, source_excerpt, source_excerpt_display, extraction_method, confidence,
  status, display_order, last_verified_at
) values (
  (select id from public.visa_types where visaai_id = 'ca-express-entry'),
  'documents_to_get_ready', 'evidence', true,
  'Get your documents ready', 'IRCC names five document categories for an Express Entry application: language test, education, job offer, funds and police certificates. The requirements and thresholds for each are on a separate get-your-documents-ready page that is not a registered source, so nothing further is claimed about them here.',
  null, null,
  null, '{}'::jsonb,
  -- Scoped to THIS visa type, not just the URL. Since
  -- 20260820160000 a shared government page has one visa_sources row per visa
  -- type it serves — GOV.UK's Standard Visitor page covers both the general
  -- and the business-visit entries — so matching on source_url alone returns
  -- two active versions and the subquery errors with "more than one row".
  --
  -- The limit 1 after the visa-type filter is belt-and-braces: the partial unique
  -- index already allows one active version per source, so the filter alone is
  -- sufficient, but a country-level source (visa_type_id null) shared with a
  -- typed one would otherwise still be ambiguous.
  (select v.id from public.visa_source_versions v
     join public.visa_sources s on s.id = v.source_id
    where s.source_url = 'https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry.html'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'ca-express-entry'))
    order by s.visa_type_id nulls last
    limit 1),
  'get your documents ready language test, education, job offer, funds, police certificates', 'Get your documents ready Language test, education, job offer, funds, police certificates', 'manual', 1.00,
  'draft', 100, '2026-08-21'::timestamptz
)
on conflict (visa_type_id, requirement_code) where status <> 'retired'
do update set
  kind = excluded.kind,
  officially_required = excluded.officially_required,
  label = excluded.label,
  description = excluded.description,
  official_form_code = excluded.official_form_code,
  official_form_url = excluded.official_form_url,
  rule = excluded.rule,
  parameters = excluded.parameters,
  source_version_id = excluded.source_version_id,
  source_excerpt = excluded.source_excerpt,
  source_excerpt_display = excluded.source_excerpt_display,
  last_verified_at = excluded.last_verified_at,
  -- DEMOTE ON CHANGE. Without this clause, re-running an extraction silently
  -- rewrote the label, rule and excerpt of an ALREADY-REVIEWED requirement
  -- while leaving it 'active', so an edit to the extraction file reached
  -- applicants without anyone re-reading it. That is the same failure the
  -- sync's promotion queue exists to prevent, one layer down.
  --
  -- Any change to what the requirement CLAIMS sends it back to draft. A re-run
  -- that confirms the same text touches only last_verified_at and leaves the
  -- review intact, which is what re-verification should do.
  status = case
    when public.visa_requirements.kind is distinct from excluded.kind
      or public.visa_requirements.officially_required is distinct from excluded.officially_required
      or public.visa_requirements.label is distinct from excluded.label
      or public.visa_requirements.description is distinct from excluded.description
      or public.visa_requirements.official_form_code is distinct from excluded.official_form_code
      or public.visa_requirements.rule is distinct from excluded.rule
      or public.visa_requirements.parameters is distinct from excluded.parameters
      or public.visa_requirements.source_excerpt is distinct from excluded.source_excerpt
    then 'draft'
    else public.visa_requirements.status
  end;

insert into public.visa_requirements (
  visa_type_id, requirement_code, kind, officially_required, label, description,
  official_form_code, official_form_url, rule, parameters,
  source_version_id, source_excerpt, source_excerpt_display, extraction_method, confidence,
  status, display_order, last_verified_at
) values (
  (select id from public.visa_types where visaai_id = 'ca-express-entry'),
  'eligibility_questionnaire', 'step', true,
  'Answer the eligibility questionnaire', 'IRCC offers two routes: the Come to Canada tool, which ends in a personal reference code used to move your information into your Express Entry profile, or the questionnaire inside your IRCC secure account.',
  null, null,
  null, '{}'::jsonb,
  -- Scoped to THIS visa type, not just the URL. Since
  -- 20260820160000 a shared government page has one visa_sources row per visa
  -- type it serves — GOV.UK's Standard Visitor page covers both the general
  -- and the business-visit entries — so matching on source_url alone returns
  -- two active versions and the subquery errors with "more than one row".
  --
  -- The limit 1 after the visa-type filter is belt-and-braces: the partial unique
  -- index already allows one active version per source, so the filter alone is
  -- sufficient, but a country-level source (visa_type_id null) shared with a
  -- typed one would otherwise still be ambiguous.
  (select v.id from public.visa_source_versions v
     join public.visa_sources s on s.id = v.source_id
    where s.source_url = 'https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry/works.html'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'ca-express-entry'))
    order by s.visa_type_id nulls last
    limit 1),
  'answer a questionnaire to check if you’re eligible for the minimum requirements of express entry. to answer the questionnaire, you have 2 options: option 1: come to canada tool answer a few questions using the come to canada tool to assess your eligibility. the tool gives you a number at the end (a personal reference code).', 'Answer a questionnaire to check if you’re eligible for the minimum requirements of Express Entry. To answer the questionnaire, you have 2 options: Option 1: Come to Canada tool Answer a few questions using the Come to Canada tool to assess your eligibility. The tool gives you a number at the end (a personal reference code).', 'manual', 1.00,
  'draft', 300, '2026-08-21'::timestamptz
)
on conflict (visa_type_id, requirement_code) where status <> 'retired'
do update set
  kind = excluded.kind,
  officially_required = excluded.officially_required,
  label = excluded.label,
  description = excluded.description,
  official_form_code = excluded.official_form_code,
  official_form_url = excluded.official_form_url,
  rule = excluded.rule,
  parameters = excluded.parameters,
  source_version_id = excluded.source_version_id,
  source_excerpt = excluded.source_excerpt,
  source_excerpt_display = excluded.source_excerpt_display,
  last_verified_at = excluded.last_verified_at,
  -- DEMOTE ON CHANGE. Without this clause, re-running an extraction silently
  -- rewrote the label, rule and excerpt of an ALREADY-REVIEWED requirement
  -- while leaving it 'active', so an edit to the extraction file reached
  -- applicants without anyone re-reading it. That is the same failure the
  -- sync's promotion queue exists to prevent, one layer down.
  --
  -- Any change to what the requirement CLAIMS sends it back to draft. A re-run
  -- that confirms the same text touches only last_verified_at and leaves the
  -- review intact, which is what re-verification should do.
  status = case
    when public.visa_requirements.kind is distinct from excluded.kind
      or public.visa_requirements.officially_required is distinct from excluded.officially_required
      or public.visa_requirements.label is distinct from excluded.label
      or public.visa_requirements.description is distinct from excluded.description
      or public.visa_requirements.official_form_code is distinct from excluded.official_form_code
      or public.visa_requirements.rule is distinct from excluded.rule
      or public.visa_requirements.parameters is distinct from excluded.parameters
      or public.visa_requirements.source_excerpt is distinct from excluded.source_excerpt
    then 'draft'
    else public.visa_requirements.status
  end;

insert into public.visa_requirements (
  visa_type_id, requirement_code, kind, officially_required, label, description,
  official_form_code, official_form_url, rule, parameters,
  source_version_id, source_excerpt, source_excerpt_display, extraction_method, confidence,
  status, display_order, last_verified_at
) values (
  (select id from public.visa_types where visaai_id = 'ca-express-entry'),
  'create_profile_and_enter_pool', 'step', true,
  'Create a profile and enter the pool', 'IRCC invites the candidates with the most points in rounds; only an invited candidate fills out the application.',
  null, null,
  null, '{}'::jsonb,
  -- Scoped to THIS visa type, not just the URL. Since
  -- 20260820160000 a shared government page has one visa_sources row per visa
  -- type it serves — GOV.UK's Standard Visitor page covers both the general
  -- and the business-visit entries — so matching on source_url alone returns
  -- two active versions and the subquery errors with "more than one row".
  --
  -- The limit 1 after the visa-type filter is belt-and-braces: the partial unique
  -- index already allows one active version per source, so the filter alone is
  -- sufficient, but a country-level source (visa_type_id null) shared with a
  -- typed one would otherwise still be ambiguous.
  (select v.id from public.visa_source_versions v
     join public.visa_sources s on s.id = v.source_id
    where s.source_url = 'https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry.html'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'ca-express-entry'))
    order by s.visa_type_id nulls last
    limit 1),
  'how the express entry process works: create a profile and enter the pool. we''ll invite the candidates with the most points in rounds. if you''re invited to apply, fill out the application. we''ll review your application and make a decision.', 'How the Express Entry process works: Create a profile and enter the pool. We''ll invite the candidates with the most points in rounds. If you''re invited to apply, fill out the application. We''ll review your application and make a decision.', 'manual', 1.00,
  'draft', 310, '2026-08-21'::timestamptz
)
on conflict (visa_type_id, requirement_code) where status <> 'retired'
do update set
  kind = excluded.kind,
  officially_required = excluded.officially_required,
  label = excluded.label,
  description = excluded.description,
  official_form_code = excluded.official_form_code,
  official_form_url = excluded.official_form_url,
  rule = excluded.rule,
  parameters = excluded.parameters,
  source_version_id = excluded.source_version_id,
  source_excerpt = excluded.source_excerpt,
  source_excerpt_display = excluded.source_excerpt_display,
  last_verified_at = excluded.last_verified_at,
  -- DEMOTE ON CHANGE. Without this clause, re-running an extraction silently
  -- rewrote the label, rule and excerpt of an ALREADY-REVIEWED requirement
  -- while leaving it 'active', so an edit to the extraction file reached
  -- applicants without anyone re-reading it. That is the same failure the
  -- sync's promotion queue exists to prevent, one layer down.
  --
  -- Any change to what the requirement CLAIMS sends it back to draft. A re-run
  -- that confirms the same text touches only last_verified_at and leaves the
  -- review intact, which is what re-verification should do.
  status = case
    when public.visa_requirements.kind is distinct from excluded.kind
      or public.visa_requirements.officially_required is distinct from excluded.officially_required
      or public.visa_requirements.label is distinct from excluded.label
      or public.visa_requirements.description is distinct from excluded.description
      or public.visa_requirements.official_form_code is distinct from excluded.official_form_code
      or public.visa_requirements.rule is distinct from excluded.rule
      or public.visa_requirements.parameters is distinct from excluded.parameters
      or public.visa_requirements.source_excerpt is distinct from excluded.source_excerpt
    then 'draft'
    else public.visa_requirements.status
  end;

insert into public.visa_requirements (
  visa_type_id, requirement_code, kind, officially_required, label, description,
  official_form_code, official_form_url, rule, parameters,
  source_version_id, source_excerpt, source_excerpt_display, extraction_method, confidence,
  status, display_order, last_verified_at
) values (
  (select id from public.visa_types where visaai_id = 'ca-express-entry'),
  'crs_score', 'step', true,
  'Calculate your Comprehensive Ranking System (CRS) score', 'The CRS score decides which candidates in the pool are invited. IRCC publishes the scoring tables and the cut-off for each round on separate pages that were not read.',
  null, null,
  null, '{}'::jsonb,
  -- Scoped to THIS visa type, not just the URL. Since
  -- 20260820160000 a shared government page has one visa_sources row per visa
  -- type it serves — GOV.UK's Standard Visitor page covers both the general
  -- and the business-visit entries — so matching on source_url alone returns
  -- two active versions and the subquery errors with "more than one row".
  --
  -- The limit 1 after the visa-type filter is belt-and-braces: the partial unique
  -- index already allows one active version per source, so the filter alone is
  -- sufficient, but a country-level source (visa_type_id null) shared with a
  -- typed one would otherwise still be ambiguous.
  (select v.id from public.visa_source_versions v
     join public.visa_sources s on s.id = v.source_id
    where s.source_url = 'https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry.html'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'ca-express-entry'))
    order by s.visa_type_id nulls last
    limit 1),
  'check your score calculate your comprehensive ranking system (crs) score', 'Check your score Calculate your Comprehensive Ranking System (CRS) score', 'manual', 1.00,
  'draft', 320, '2026-08-21'::timestamptz
)
on conflict (visa_type_id, requirement_code) where status <> 'retired'
do update set
  kind = excluded.kind,
  officially_required = excluded.officially_required,
  label = excluded.label,
  description = excluded.description,
  official_form_code = excluded.official_form_code,
  official_form_url = excluded.official_form_url,
  rule = excluded.rule,
  parameters = excluded.parameters,
  source_version_id = excluded.source_version_id,
  source_excerpt = excluded.source_excerpt,
  source_excerpt_display = excluded.source_excerpt_display,
  last_verified_at = excluded.last_verified_at,
  -- DEMOTE ON CHANGE. Without this clause, re-running an extraction silently
  -- rewrote the label, rule and excerpt of an ALREADY-REVIEWED requirement
  -- while leaving it 'active', so an edit to the extraction file reached
  -- applicants without anyone re-reading it. That is the same failure the
  -- sync's promotion queue exists to prevent, one layer down.
  --
  -- Any change to what the requirement CLAIMS sends it back to draft. A re-run
  -- that confirms the same text touches only last_verified_at and leaves the
  -- review intact, which is what re-verification should do.
  status = case
    when public.visa_requirements.kind is distinct from excluded.kind
      or public.visa_requirements.officially_required is distinct from excluded.officially_required
      or public.visa_requirements.label is distinct from excluded.label
      or public.visa_requirements.description is distinct from excluded.description
      or public.visa_requirements.official_form_code is distinct from excluded.official_form_code
      or public.visa_requirements.rule is distinct from excluded.rule
      or public.visa_requirements.parameters is distinct from excluded.parameters
      or public.visa_requirements.source_excerpt is distinct from excluded.source_excerpt
    then 'draft'
    else public.visa_requirements.status
  end;

insert into public.visa_requirements (
  visa_type_id, requirement_code, kind, officially_required, label, description,
  official_form_code, official_form_url, rule, parameters,
  source_version_id, source_excerpt, source_excerpt_display, extraction_method, confidence,
  status, display_order, last_verified_at
) values (
  (select id from public.visa_types where visaai_id = 'ca-express-entry'),
  'apply_for_permanent_residence', 'step', true,
  'Submit the online permanent residence application', 'Available only after an invitation to apply. IRCC describes the step as submitting the online form, uploading documents and paying the fees.',
  null, null,
  null, '{}'::jsonb,
  -- Scoped to THIS visa type, not just the URL. Since
  -- 20260820160000 a shared government page has one visa_sources row per visa
  -- type it serves — GOV.UK's Standard Visitor page covers both the general
  -- and the business-visit entries — so matching on source_url alone returns
  -- two active versions and the subquery errors with "more than one row".
  --
  -- The limit 1 after the visa-type filter is belt-and-braces: the partial unique
  -- index already allows one active version per source, so the filter alone is
  -- sufficient, but a country-level source (visa_type_id null) shared with a
  -- typed one would otherwise still be ambiguous.
  (select v.id from public.visa_source_versions v
     join public.visa_sources s on s.id = v.source_id
    where s.source_url = 'https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry.html'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'ca-express-entry'))
    order by s.visa_type_id nulls last
    limit 1),
  'apply for permanent residence submit the online form, upload documents, pay your fees', 'Apply for permanent residence Submit the online form, upload documents, pay your fees', 'manual', 1.00,
  'draft', 330, '2026-08-21'::timestamptz
)
on conflict (visa_type_id, requirement_code) where status <> 'retired'
do update set
  kind = excluded.kind,
  officially_required = excluded.officially_required,
  label = excluded.label,
  description = excluded.description,
  official_form_code = excluded.official_form_code,
  official_form_url = excluded.official_form_url,
  rule = excluded.rule,
  parameters = excluded.parameters,
  source_version_id = excluded.source_version_id,
  source_excerpt = excluded.source_excerpt,
  source_excerpt_display = excluded.source_excerpt_display,
  last_verified_at = excluded.last_verified_at,
  -- DEMOTE ON CHANGE. Without this clause, re-running an extraction silently
  -- rewrote the label, rule and excerpt of an ALREADY-REVIEWED requirement
  -- while leaving it 'active', so an edit to the extraction file reached
  -- applicants without anyone re-reading it. That is the same failure the
  -- sync's promotion queue exists to prevent, one layer down.
  --
  -- Any change to what the requirement CLAIMS sends it back to draft. A re-run
  -- that confirms the same text touches only last_verified_at and leaves the
  -- review intact, which is what re-verification should do.
  status = case
    when public.visa_requirements.kind is distinct from excluded.kind
      or public.visa_requirements.officially_required is distinct from excluded.officially_required
      or public.visa_requirements.label is distinct from excluded.label
      or public.visa_requirements.description is distinct from excluded.description
      or public.visa_requirements.official_form_code is distinct from excluded.official_form_code
      or public.visa_requirements.rule is distinct from excluded.rule
      or public.visa_requirements.parameters is distinct from excluded.parameters
      or public.visa_requirements.source_excerpt is distinct from excluded.source_excerpt
    then 'draft'
    else public.visa_requirements.status
  end;

insert into public.visa_requirements (
  visa_type_id, requirement_code, kind, officially_required, label, description,
  official_form_code, official_form_url, rule, parameters,
  source_version_id, source_excerpt, source_excerpt_display, extraction_method, confidence,
  status, display_order, last_verified_at
) values (
  (select id from public.visa_types where visaai_id = 'ca-express-entry'),
  'biometrics', 'step', true,
  'Give your biometrics after you apply', 'IRCC lists biometrics as part of the after-you-apply stage. Neither page read states who must give them or what they cost for a permanent residence application, so no fee is recorded for this step.',
  null, null,
  null, '{}'::jsonb,
  -- Scoped to THIS visa type, not just the URL. Since
  -- 20260820160000 a shared government page has one visa_sources row per visa
  -- type it serves — GOV.UK's Standard Visitor page covers both the general
  -- and the business-visit entries — so matching on source_url alone returns
  -- two active versions and the subquery errors with "more than one row".
  --
  -- The limit 1 after the visa-type filter is belt-and-braces: the partial unique
  -- index already allows one active version per source, so the filter alone is
  -- sufficient, but a country-level source (visa_type_id null) shared with a
  -- typed one would otherwise still be ambiguous.
  (select v.id from public.visa_source_versions v
     join public.visa_sources s on s.id = v.source_id
    where s.source_url = 'https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry.html'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'ca-express-entry'))
    order by s.visa_type_id nulls last
    limit 1),
  'after you apply biometrics, processing, application status', 'After you apply Biometrics, processing, application status', 'manual', 1.00,
  'draft', 340, '2026-08-21'::timestamptz
)
on conflict (visa_type_id, requirement_code) where status <> 'retired'
do update set
  kind = excluded.kind,
  officially_required = excluded.officially_required,
  label = excluded.label,
  description = excluded.description,
  official_form_code = excluded.official_form_code,
  official_form_url = excluded.official_form_url,
  rule = excluded.rule,
  parameters = excluded.parameters,
  source_version_id = excluded.source_version_id,
  source_excerpt = excluded.source_excerpt,
  source_excerpt_display = excluded.source_excerpt_display,
  last_verified_at = excluded.last_verified_at,
  -- DEMOTE ON CHANGE. Without this clause, re-running an extraction silently
  -- rewrote the label, rule and excerpt of an ALREADY-REVIEWED requirement
  -- while leaving it 'active', so an edit to the extraction file reached
  -- applicants without anyone re-reading it. That is the same failure the
  -- sync's promotion queue exists to prevent, one layer down.
  --
  -- Any change to what the requirement CLAIMS sends it back to draft. A re-run
  -- that confirms the same text touches only last_verified_at and leaves the
  -- review intact, which is what re-verification should do.
  status = case
    when public.visa_requirements.kind is distinct from excluded.kind
      or public.visa_requirements.officially_required is distinct from excluded.officially_required
      or public.visa_requirements.label is distinct from excluded.label
      or public.visa_requirements.description is distinct from excluded.description
      or public.visa_requirements.official_form_code is distinct from excluded.official_form_code
      or public.visa_requirements.rule is distinct from excluded.rule
      or public.visa_requirements.parameters is distinct from excluded.parameters
      or public.visa_requirements.source_excerpt is distinct from excluded.source_excerpt
    then 'draft'
    else public.visa_requirements.status
  end;

insert into public.visa_requirements (
  visa_type_id, requirement_code, kind, officially_required, label, description,
  official_form_code, official_form_url, rule, parameters,
  source_version_id, source_excerpt, source_excerpt_display, extraction_method, confidence,
  status, display_order, last_verified_at
) values (
  (select id from public.visa_types where visaai_id = 'ca-express-entry'),
  'economic_immigration_application_fee', 'fee', true,
  'Permanent residence application fee (economic immigration, including Express Entry)', 'CAD 1,590.00, which IRCC states includes the processing fee and the right of permanent residence fee. CAD 990.00 is the same application without the right of permanent residence fee. IRCC lists this fee band for the Canadian Experience Class, federal skilled workers and federal skilled trades, alongside several other economic programs.',
  null, null,
  null, '{"amount":1590,"currency":"CAD","unit":"per principal applicant","amount_without_rprf":990,"includes":["processing fee","right of permanent residence fee"],"read_at":"2026-08-21"}'::jsonb,
  -- Scoped to THIS visa type, not just the URL. Since
  -- 20260820160000 a shared government page has one visa_sources row per visa
  -- type it serves — GOV.UK's Standard Visitor page covers both the general
  -- and the business-visit entries — so matching on source_url alone returns
  -- two active versions and the subquery errors with "more than one row".
  --
  -- The limit 1 after the visa-type filter is belt-and-braces: the partial unique
  -- index already allows one active version per source, so the filter alone is
  -- sufficient, but a country-level source (visa_type_id null) shared with a
  -- typed one would otherwise still be ambiguous.
  (select v.id from public.visa_source_versions v
     join public.visa_sources s on s.id = v.source_id
    where s.source_url = 'https://ircc.canada.ca/english/information/fees/fees.asp'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'ca-express-entry'))
    order by s.visa_type_id nulls last
    limit 1),
  'economic immigration (including express entry) these fees apply to: atlantic immigration program canadian experience class federal skilled workers federal skilled trades provincial nominee rural or francophone community immigration pilots quebec-selected skilled workers fees $can your application this amount includes the processing fee and the right of permanent residence fee. 1,590.00 your application (without right of permanent residence fee) 990.00', 'Economic immigration (including Express Entry) These fees apply to: Atlantic immigration program Canadian experience class Federal skilled workers Federal skilled trades Provincial nominee Rural or francophone community immigration pilots Quebec-selected skilled workers Fees $CAN Your application This amount includes the processing fee and the right of permanent residence fee. 1,590.00 Your application (without right of permanent residence fee) 990.00', 'manual', 1.00,
  'draft', 400, '2026-08-21'::timestamptz
)
on conflict (visa_type_id, requirement_code) where status <> 'retired'
do update set
  kind = excluded.kind,
  officially_required = excluded.officially_required,
  label = excluded.label,
  description = excluded.description,
  official_form_code = excluded.official_form_code,
  official_form_url = excluded.official_form_url,
  rule = excluded.rule,
  parameters = excluded.parameters,
  source_version_id = excluded.source_version_id,
  source_excerpt = excluded.source_excerpt,
  source_excerpt_display = excluded.source_excerpt_display,
  last_verified_at = excluded.last_verified_at,
  -- DEMOTE ON CHANGE. Without this clause, re-running an extraction silently
  -- rewrote the label, rule and excerpt of an ALREADY-REVIEWED requirement
  -- while leaving it 'active', so an edit to the extraction file reached
  -- applicants without anyone re-reading it. That is the same failure the
  -- sync's promotion queue exists to prevent, one layer down.
  --
  -- Any change to what the requirement CLAIMS sends it back to draft. A re-run
  -- that confirms the same text touches only last_verified_at and leaves the
  -- review intact, which is what re-verification should do.
  status = case
    when public.visa_requirements.kind is distinct from excluded.kind
      or public.visa_requirements.officially_required is distinct from excluded.officially_required
      or public.visa_requirements.label is distinct from excluded.label
      or public.visa_requirements.description is distinct from excluded.description
      or public.visa_requirements.official_form_code is distinct from excluded.official_form_code
      or public.visa_requirements.rule is distinct from excluded.rule
      or public.visa_requirements.parameters is distinct from excluded.parameters
      or public.visa_requirements.source_excerpt is distinct from excluded.source_excerpt
    then 'draft'
    else public.visa_requirements.status
  end;

insert into public.visa_requirements (
  visa_type_id, requirement_code, kind, officially_required, label, description,
  official_form_code, official_form_url, rule, parameters,
  source_version_id, source_excerpt, source_excerpt_display, extraction_method, confidence,
  status, display_order, last_verified_at
) values (
  (select id from public.visa_types where visaai_id = 'ca-express-entry'),
  'spouse_or_partner_fee', 'fee', true,
  'Fee to include your spouse or partner', 'CAD 1,590.00 including the right of permanent residence fee, or CAD 990.00 without it.',
  null, null,
  '{"fact":"marital_status","op":"in","value":["married","common_law","de_facto","partnered"]}'::jsonb, '{"amount":1590,"currency":"CAD","unit":"per spouse or partner included","amount_without_rprf":990,"read_at":"2026-08-21"}'::jsonb,
  -- Scoped to THIS visa type, not just the URL. Since
  -- 20260820160000 a shared government page has one visa_sources row per visa
  -- type it serves — GOV.UK's Standard Visitor page covers both the general
  -- and the business-visit entries — so matching on source_url alone returns
  -- two active versions and the subquery errors with "more than one row".
  --
  -- The limit 1 after the visa-type filter is belt-and-braces: the partial unique
  -- index already allows one active version per source, so the filter alone is
  -- sufficient, but a country-level source (visa_type_id null) shared with a
  -- typed one would otherwise still be ambiguous.
  (select v.id from public.visa_source_versions v
     join public.visa_sources s on s.id = v.source_id
    where s.source_url = 'https://ircc.canada.ca/english/information/fees/fees.asp'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'ca-express-entry'))
    order by s.visa_type_id nulls last
    limit 1),
  'include your spouse or partner this amount includes the processing fee and the right of permanent residence fee. 1,590.00 include your spouse or partner (without right of permanent residence fee) 990.00', 'Include your spouse or partner This amount includes the processing fee and the right of permanent residence fee. 1,590.00 Include your spouse or partner (without right of permanent residence fee) 990.00', 'manual', 1.00,
  'draft', 410, '2026-08-21'::timestamptz
)
on conflict (visa_type_id, requirement_code) where status <> 'retired'
do update set
  kind = excluded.kind,
  officially_required = excluded.officially_required,
  label = excluded.label,
  description = excluded.description,
  official_form_code = excluded.official_form_code,
  official_form_url = excluded.official_form_url,
  rule = excluded.rule,
  parameters = excluded.parameters,
  source_version_id = excluded.source_version_id,
  source_excerpt = excluded.source_excerpt,
  source_excerpt_display = excluded.source_excerpt_display,
  last_verified_at = excluded.last_verified_at,
  -- DEMOTE ON CHANGE. Without this clause, re-running an extraction silently
  -- rewrote the label, rule and excerpt of an ALREADY-REVIEWED requirement
  -- while leaving it 'active', so an edit to the extraction file reached
  -- applicants without anyone re-reading it. That is the same failure the
  -- sync's promotion queue exists to prevent, one layer down.
  --
  -- Any change to what the requirement CLAIMS sends it back to draft. A re-run
  -- that confirms the same text touches only last_verified_at and leaves the
  -- review intact, which is what re-verification should do.
  status = case
    when public.visa_requirements.kind is distinct from excluded.kind
      or public.visa_requirements.officially_required is distinct from excluded.officially_required
      or public.visa_requirements.label is distinct from excluded.label
      or public.visa_requirements.description is distinct from excluded.description
      or public.visa_requirements.official_form_code is distinct from excluded.official_form_code
      or public.visa_requirements.rule is distinct from excluded.rule
      or public.visa_requirements.parameters is distinct from excluded.parameters
      or public.visa_requirements.source_excerpt is distinct from excluded.source_excerpt
    then 'draft'
    else public.visa_requirements.status
  end;

insert into public.visa_requirements (
  visa_type_id, requirement_code, kind, officially_required, label, description,
  official_form_code, official_form_url, rule, parameters,
  source_version_id, source_excerpt, source_excerpt_display, extraction_method, confidence,
  status, display_order, last_verified_at
) values (
  (select id from public.visa_types where visaai_id = 'ca-express-entry'),
  'dependent_child_fee', 'fee', true,
  'Fee to include a dependent child', 'CAD 270.00 per child.',
  null, null,
  '{"fact":"has_dependants","op":"eq","value":true}'::jsonb, '{"amount":270,"currency":"CAD","unit":"per child","read_at":"2026-08-21"}'::jsonb,
  -- Scoped to THIS visa type, not just the URL. Since
  -- 20260820160000 a shared government page has one visa_sources row per visa
  -- type it serves — GOV.UK's Standard Visitor page covers both the general
  -- and the business-visit entries — so matching on source_url alone returns
  -- two active versions and the subquery errors with "more than one row".
  --
  -- The limit 1 after the visa-type filter is belt-and-braces: the partial unique
  -- index already allows one active version per source, so the filter alone is
  -- sufficient, but a country-level source (visa_type_id null) shared with a
  -- typed one would otherwise still be ambiguous.
  (select v.id from public.visa_source_versions v
     join public.visa_sources s on s.id = v.source_id
    where s.source_url = 'https://ircc.canada.ca/english/information/fees/fees.asp'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'ca-express-entry'))
    order by s.visa_type_id nulls last
    limit 1),
  'include a dependent child 270.00 (per child)', 'Include a dependent child 270.00 (per child)', 'manual', 1.00,
  'draft', 420, '2026-08-21'::timestamptz
)
on conflict (visa_type_id, requirement_code) where status <> 'retired'
do update set
  kind = excluded.kind,
  officially_required = excluded.officially_required,
  label = excluded.label,
  description = excluded.description,
  official_form_code = excluded.official_form_code,
  official_form_url = excluded.official_form_url,
  rule = excluded.rule,
  parameters = excluded.parameters,
  source_version_id = excluded.source_version_id,
  source_excerpt = excluded.source_excerpt,
  source_excerpt_display = excluded.source_excerpt_display,
  last_verified_at = excluded.last_verified_at,
  -- DEMOTE ON CHANGE. Without this clause, re-running an extraction silently
  -- rewrote the label, rule and excerpt of an ALREADY-REVIEWED requirement
  -- while leaving it 'active', so an edit to the extraction file reached
  -- applicants without anyone re-reading it. That is the same failure the
  -- sync's promotion queue exists to prevent, one layer down.
  --
  -- Any change to what the requirement CLAIMS sends it back to draft. A re-run
  -- that confirms the same text touches only last_verified_at and leaves the
  -- review intact, which is what re-verification should do.
  status = case
    when public.visa_requirements.kind is distinct from excluded.kind
      or public.visa_requirements.officially_required is distinct from excluded.officially_required
      or public.visa_requirements.label is distinct from excluded.label
      or public.visa_requirements.description is distinct from excluded.description
      or public.visa_requirements.official_form_code is distinct from excluded.official_form_code
      or public.visa_requirements.rule is distinct from excluded.rule
      or public.visa_requirements.parameters is distinct from excluded.parameters
      or public.visa_requirements.source_excerpt is distinct from excluded.source_excerpt
    then 'draft'
    else public.visa_requirements.status
  end;

insert into public.visa_requirements (
  visa_type_id, requirement_code, kind, officially_required, label, description,
  official_form_code, official_form_url, rule, parameters,
  source_version_id, source_excerpt, source_excerpt_display, extraction_method, confidence,
  status, display_order, last_verified_at
) values (
  (select id from public.visa_types where visaai_id = 'ca-express-entry'),
  'right_of_permanent_residence_fee', 'fee', true,
  'Right of permanent residence fee', 'CAD 600.00. It is already inside the CAD 1,590.00 amounts above — the CAD 990.00 variants are those amounts with this fee removed. IRCC states it is payable before you become a permanent resident, that paying it with the application fees avoids delays, that it is refunded if you withdraw or IRCC refuses the application, and that it does not apply to the dependent children of a principal applicant.',
  null, null,
  null, '{"amount":600,"currency":"CAD","unit":"per person","read_at":"2026-08-21"}'::jsonb,
  -- Scoped to THIS visa type, not just the URL. Since
  -- 20260820160000 a shared government page has one visa_sources row per visa
  -- type it serves — GOV.UK's Standard Visitor page covers both the general
  -- and the business-visit entries — so matching on source_url alone returns
  -- two active versions and the subquery errors with "more than one row".
  --
  -- The limit 1 after the visa-type filter is belt-and-braces: the partial unique
  -- index already allows one active version per source, so the filter alone is
  -- sufficient, but a country-level source (visa_type_id null) shared with a
  -- typed one would otherwise still be ambiguous.
  (select v.id from public.visa_source_versions v
     join public.visa_sources s on s.id = v.source_id
    where s.source_url = 'https://ircc.canada.ca/english/information/fees/fees.asp'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'ca-express-entry'))
    order by s.visa_type_id nulls last
    limit 1),
  'right of permanent residence fee fees $can right of permanent residence fee 600.00 for most permanent residence applications, you need to pay the right of permanent residence fee (rprf) when your application is approved. you will have to pay it before you can become a permanent resident.', 'Right of permanent residence fee Fees $CAN Right of permanent residence fee 600.00 For most permanent residence applications, you need to pay the right of permanent residence fee (RPRF) when your application is approved. You will have to pay it before you can become a permanent resident.', 'manual', 1.00,
  'draft', 430, '2026-08-21'::timestamptz
)
on conflict (visa_type_id, requirement_code) where status <> 'retired'
do update set
  kind = excluded.kind,
  officially_required = excluded.officially_required,
  label = excluded.label,
  description = excluded.description,
  official_form_code = excluded.official_form_code,
  official_form_url = excluded.official_form_url,
  rule = excluded.rule,
  parameters = excluded.parameters,
  source_version_id = excluded.source_version_id,
  source_excerpt = excluded.source_excerpt,
  source_excerpt_display = excluded.source_excerpt_display,
  last_verified_at = excluded.last_verified_at,
  -- DEMOTE ON CHANGE. Without this clause, re-running an extraction silently
  -- rewrote the label, rule and excerpt of an ALREADY-REVIEWED requirement
  -- while leaving it 'active', so an edit to the extraction file reached
  -- applicants without anyone re-reading it. That is the same failure the
  -- sync's promotion queue exists to prevent, one layer down.
  --
  -- Any change to what the requirement CLAIMS sends it back to draft. A re-run
  -- that confirms the same text touches only last_verified_at and leaves the
  -- review intact, which is what re-verification should do.
  status = case
    when public.visa_requirements.kind is distinct from excluded.kind
      or public.visa_requirements.officially_required is distinct from excluded.officially_required
      or public.visa_requirements.label is distinct from excluded.label
      or public.visa_requirements.description is distinct from excluded.description
      or public.visa_requirements.official_form_code is distinct from excluded.official_form_code
      or public.visa_requirements.rule is distinct from excluded.rule
      or public.visa_requirements.parameters is distinct from excluded.parameters
      or public.visa_requirements.source_excerpt is distinct from excluded.source_excerpt
    then 'draft'
    else public.visa_requirements.status
  end;

insert into public.visa_requirements (
  visa_type_id, requirement_code, kind, officially_required, label, description,
  official_form_code, official_form_url, rule, parameters,
  source_version_id, source_excerpt, source_excerpt_display, extraction_method, confidence,
  status, display_order, last_verified_at
) values (
  (select id from public.visa_types where visaai_id = 'ca-express-entry'),
  'provincial_nominee_program', 'recommended', false,
  'Consider applying through the Provincial Nominee Program', 'IRCC presents this as an option, not a requirement: a candidate eligible for one of the three Express Entry programs may also apply through Express Entry for the Provincial Nominee Program, and a nomination earns extra points. PNP criteria are set by each province and were not read.',
  null, null,
  null, '{}'::jsonb,
  -- Scoped to THIS visa type, not just the URL. Since
  -- 20260820160000 a shared government page has one visa_sources row per visa
  -- type it serves — GOV.UK's Standard Visitor page covers both the general
  -- and the business-visit entries — so matching on source_url alone returns
  -- two active versions and the subquery errors with "more than one row".
  --
  -- The limit 1 after the visa-type filter is belt-and-braces: the partial unique
  -- index already allows one active version per source, so the filter alone is
  -- sufficient, but a country-level source (visa_type_id null) shared with a
  -- typed one would otherwise still be ambiguous.
  (select v.id from public.visa_source_versions v
     join public.visa_sources s on s.id = v.source_id
    where s.source_url = 'https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry/works.html'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'ca-express-entry'))
    order by s.visa_type_id nulls last
    limit 1),
  'if you’re eligible for one of these programs, you can also apply through express entry for the provincial nominee program. if you’re nominated, you’ll get extra points so you can be invited to apply quickly.', 'If you’re eligible for one of these programs, you can also apply through Express Entry for the Provincial Nominee Program. If you’re nominated, you’ll get extra points so you can be invited to apply quickly.', 'manual', 1.00,
  'draft', 500, '2026-08-21'::timestamptz
)
on conflict (visa_type_id, requirement_code) where status <> 'retired'
do update set
  kind = excluded.kind,
  officially_required = excluded.officially_required,
  label = excluded.label,
  description = excluded.description,
  official_form_code = excluded.official_form_code,
  official_form_url = excluded.official_form_url,
  rule = excluded.rule,
  parameters = excluded.parameters,
  source_version_id = excluded.source_version_id,
  source_excerpt = excluded.source_excerpt,
  source_excerpt_display = excluded.source_excerpt_display,
  last_verified_at = excluded.last_verified_at,
  -- DEMOTE ON CHANGE. Without this clause, re-running an extraction silently
  -- rewrote the label, rule and excerpt of an ALREADY-REVIEWED requirement
  -- while leaving it 'active', so an edit to the extraction file reached
  -- applicants without anyone re-reading it. That is the same failure the
  -- sync's promotion queue exists to prevent, one layer down.
  --
  -- Any change to what the requirement CLAIMS sends it back to draft. A re-run
  -- that confirms the same text touches only last_verified_at and leaves the
  -- review intact, which is what re-verification should do.
  status = case
    when public.visa_requirements.kind is distinct from excluded.kind
      or public.visa_requirements.officially_required is distinct from excluded.officially_required
      or public.visa_requirements.label is distinct from excluded.label
      or public.visa_requirements.description is distinct from excluded.description
      or public.visa_requirements.official_form_code is distinct from excluded.official_form_code
      or public.visa_requirements.rule is distinct from excluded.rule
      or public.visa_requirements.parameters is distinct from excluded.parameters
      or public.visa_requirements.source_excerpt is distinct from excluded.source_excerpt
    then 'draft'
    else public.visa_requirements.status
  end;

-- Fail loudly if any source had no active version: the NOT NULL would abort
-- anyway, but naming the cause beats reading a constraint violation.
do $$
declare missing int;
begin
  select count(*) into missing
  from (values ('https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry.html'), ('https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry/works.html'), ('https://ircc.canada.ca/english/information/fees/fees.asp')) as r(url)
  where not exists (
    select 1 from public.visa_source_versions v
      join public.visa_sources s on s.id = v.source_id
     where s.source_url = r.url and v.is_active
  );
  if missing > 0 then
    -- Replay-aware. 20260820170000 installs the fixture table for the duration
    -- of the chain, so its presence means this is a database being rebuilt from
    -- empty. An authority that blocks our egress (migri.fi, immi.homeaffairs)
    -- has no version to bind to and never will, and the skipped rows are
    -- recorded in visa_requirement_bootstrap_skips. Outside a replay this stays
    -- fatal, which is the point: in normal operation a missing version means
    -- the sync has not run and the extraction is premature.
    if to_regclass('public.visa_source_version_fixtures') is not null then
      raise warning '% source(s) have no active version; their requirements were skipped (replay)', missing;
    else
      raise exception '% source(s) have no active version. Run the sync before extracting requirements.', missing;
    end if;
  end if;
end $$;

update public.visa_requirements r
set status = 'retired'
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'ca-express-entry'
  and r.requirement_code in (
    'passport_or_travel_document', 'language_test_results', 'education_credential_proof',
    'written_job_offer', 'proof_of_work_experience', 'trade_certificate_of_qualification',
    'proof_of_funds', 'police_certificates', 'provincial_nomination')
  and r.status <> 'retired';

update public.visa_requirements r
set status = 'active'
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'ca-express-entry' and r.status = 'draft';

commit;

-- 17 requirement(s): 6 condition, 1 evidence, 5 step, 4 fee, 1 recommended
