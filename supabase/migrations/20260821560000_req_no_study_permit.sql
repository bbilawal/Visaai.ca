-- Requirements for no-study-permit, extracted 2026-08-22.
--
-- GENERATED FILE. Do not hand-edit.
--   source: data/requirements/no-study-permit.json
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
--   * The application fee amount. UDI states the obligation here and publishes the figure elsewhere.
--   * The NOKUT accreditation list for study programmes. UDI links the agency's register rather than reproducing it.
--   * Requirements that differ for folk high schools and other non-university institutions, which UDI splits behind a 'where will you be studying' selector.
--   * The document checklist, which UDI serves per-embassy behind the 'how to apply' flow.
--   * Rules for renewing a study permit or switching after graduation, which are separate permits.

begin;

insert into public.visa_requirements (
  visa_type_id, requirement_code, kind, officially_required, label, description,
  official_form_code, official_form_url, rule, parameters,
  source_version_id, source_excerpt, extraction_method, confidence,
  status, display_order, last_verified_at
) values (
  (select id from public.visa_types where visaai_id = 'no-study-permit'),
  'study_longer_than_3_months', 'condition', true,
  'Study or attend school for more than three months', null,
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
    where s.source_url = 'https://www.udi.no/en/want-to-apply/studies/studietillatelse/'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'no-study-permit'))
    order by s.visa_type_id nulls last
    limit 1),
  'if you wish to study or go to school in norway for more than three months, you must apply for a study permit.', 'manual', 1.00,
  'draft', 10, '2026-08-22'::timestamptz
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
  source_version_id, source_excerpt, extraction_method, confidence,
  status, display_order, last_verified_at
) values (
  (select id from public.visa_types where visaai_id = 'no-study-permit'),
  'work_rights', 'condition', false,
  'Work up to 20 hours a week during term, full-time in holidays', 'A right the permit grants, not an obligation. Recorded because students routinely need to know it before choosing a route.',
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
    where s.source_url = 'https://www.udi.no/en/want-to-apply/studies/studietillatelse/'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'no-study-permit'))
    order by s.visa_type_id nulls last
    limit 1),
  'if you are granted a study permit, you will also be able to work for up to 20 hours a week while you are studying and full-time during holidays.', 'manual', 1.00,
  'draft', 20, '2026-08-22'::timestamptz
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
  source_version_id, source_excerpt, extraction_method, confidence,
  status, display_order, last_verified_at
) values (
  (select id from public.visa_types where visaai_id = 'no-study-permit'),
  'application_fee', 'fee', true,
  'Pay an application fee', 'No amount recorded: UDI states the obligation here and publishes the figure elsewhere, on a page that is not a registered source.',
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
    where s.source_url = 'https://www.udi.no/en/want-to-apply/studies/studietillatelse/'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'no-study-permit'))
    order by s.visa_type_id nulls last
    limit 1),
  'you must pay an application fee.', 'manual', 1.00,
  'draft', 30, '2026-08-22'::timestamptz
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
  source_version_id, source_excerpt, extraction_method, confidence,
  status, display_order, last_verified_at
) values (
  (select id from public.visa_types where visaai_id = 'no-study-permit'),
  'admission_to_institution', 'condition', true,
  'Be admitted to a university college or university', null,
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
    where s.source_url = 'https://www.udi.no/en/want-to-apply/studies/studietillatelse/'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'no-study-permit'))
    order by s.visa_type_id nulls last
    limit 1),
  'you must have been admitted to a university college or university.', 'manual', 1.00,
  'draft', 40, '2026-08-22'::timestamptz
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
  source_version_id, source_excerpt, extraction_method, confidence,
  status, display_order, last_verified_at
) values (
  (select id from public.visa_types where visaai_id = 'no-study-permit'),
  'full_time_study', 'condition', true,
  'Study full-time', null,
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
    where s.source_url = 'https://www.udi.no/en/want-to-apply/studies/studietillatelse/'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'no-study-permit'))
    order by s.visa_type_id nulls last
    limit 1),
  'you must study full-time.', 'manual', 1.00,
  'draft', 50, '2026-08-22'::timestamptz
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
  source_version_id, source_excerpt, extraction_method, confidence,
  status, display_order, last_verified_at
) values (
  (select id from public.visa_types where visaai_id = 'no-study-permit'),
  'maintenance_funds', 'condition', true,
  'NOK 15,488 per month, or NOK 170,368 for the academic year', 'UDI writes the amounts with a space as the thousands separator (nok 15 488); the excerpt preserves that.',
  null, null,
  null, '{"per_month_nok":15488,"per_year_nok":170368,"currency":"NOK","read_at":"2026-08-22"}'::jsonb,
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
    where s.source_url = 'https://www.udi.no/en/want-to-apply/studies/studietillatelse/'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'no-study-permit'))
    order by s.visa_type_id nulls last
    limit 1),
  'you must have enough money to live on during the period you are going to study in norway. this means at least nok 15 488 per month, or nok 170 368 per year for the entire academic year.', 'manual', 1.00,
  'draft', 60, '2026-08-22'::timestamptz
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
  source_version_id, source_excerpt, extraction_method, confidence,
  status, display_order, last_verified_at
) values (
  (select id from public.visa_types where visaai_id = 'no-study-permit'),
  'maintenance_single_semester', 'condition', true,
  'Single-semester amounts: NOK 77,440 autumn, NOK 92,928 spring', 'The two semesters differ, and the spring figure is the higher one. Showing a single ''per semester'' number would understate spring by NOK 15,488.',
  null, null,
  null, '{"autumn_semester_nok":77440,"spring_semester_nok":92928,"currency":"NOK","read_at":"2026-08-22"}'::jsonb,
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
    where s.source_url = 'https://www.udi.no/en/want-to-apply/studies/studietillatelse/'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'no-study-permit'))
    order by s.visa_type_id nulls last
    limit 1),
  'if you are going to be a student for only one semester in norway, you must document nok 77 440 for the autumn semester and nok 92 928 for the spring semester.', 'manual', 1.00,
  'draft', 70, '2026-08-22'::timestamptz
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
  source_version_id, source_excerpt, extraction_method, confidence,
  status, display_order, last_verified_at
) values (
  (select id from public.visa_types where visaai_id = 'no-study-permit'),
  'acceptable_fund_sources', 'condition', true,
  'Funds may be loans, grants, own money, or an offered part-time job', null,
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
    where s.source_url = 'https://www.udi.no/en/want-to-apply/studies/studietillatelse/'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'no-study-permit'))
    order by s.visa_type_id nulls last
    limit 1),
  'this amount of money may consist of student loans, grants, own funds that you have in a norwegian bank account or the deposit account of the educational institution, or a combination of the above. if you have already been offered a part-time job in norway, the income from this work may be included.', 'manual', 1.00,
  'draft', 80, '2026-08-22'::timestamptz
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
  source_version_id, source_excerpt, extraction_method, confidence,
  status, display_order, last_verified_at
) values (
  (select id from public.visa_types where visaai_id = 'no-study-permit'),
  'funds_location', 'condition', true,
  'The money must be in a Norwegian bank account or the institution''s deposit account', 'UDI notes that a student without a Norwegian account may use the institution''s, arranged with the institution directly.',
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
    where s.source_url = 'https://www.udi.no/en/want-to-apply/studies/studietillatelse/'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'no-study-permit'))
    order by s.visa_type_id nulls last
    limit 1),
  'the money must be in a norwegian bank account or the deposit account of the educational institution.', 'manual', 1.00,
  'draft', 90, '2026-08-22'::timestamptz
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
  source_version_id, source_excerpt, extraction_method, confidence,
  status, display_order, last_verified_at
) values (
  (select id from public.visa_types where visaai_id = 'no-study-permit'),
  'tuition_fees_covered', 'condition', true,
  'Cover tuition fees as well, or document that they are already paid', 'Note the academic year named in UDI''s own text. It will date, and the daily monitor will raise the change when UDI updates it.',
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
    where s.source_url = 'https://www.udi.no/en/want-to-apply/studies/studietillatelse/'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'no-study-permit'))
    order by s.visa_type_id nulls last
    limit 1),
  'if you have to pay tuition fees, you must also have money to cover this or document in your application that your tuition fees for the academic year 2025/2026 have already been paid. if you have paid for one semester, you must provide documentation in your application showing that you have enough money to pay for the second semester.', 'manual', 1.00,
  'draft', 100, '2026-08-22'::timestamptz
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
  source_version_id, source_excerpt, extraction_method, confidence,
  status, display_order, last_verified_at
) values (
  (select id from public.visa_types where visaai_id = 'no-study-permit'),
  'tuition_exemption_confirmed', 'condition', true,
  'An exemption from tuition fees must be confirmed by the institution', null,
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
    where s.source_url = 'https://www.udi.no/en/want-to-apply/studies/studietillatelse/'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'no-study-permit'))
    order by s.visa_type_id nulls last
    limit 1),
  'if you have an exemption from paying tuition fees this must be confirmed by your educational institution.', 'manual', 1.00,
  'draft', 110, '2026-08-22'::timestamptz
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
  source_version_id, source_excerpt, extraction_method, confidence,
  status, display_order, last_verified_at
) values (
  (select id from public.visa_types where visaai_id = 'no-study-permit'),
  'accommodation', 'condition', true,
  'Have somewhere to live', null,
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
    where s.source_url = 'https://www.udi.no/en/want-to-apply/studies/studietillatelse/'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'no-study-permit'))
    order by s.visa_type_id nulls last
    limit 1),
  'you must have somewhere to live.', 'manual', 1.00,
  'draft', 120, '2026-08-22'::timestamptz
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
  source_version_id, source_excerpt, extraction_method, confidence,
  status, display_order, last_verified_at
) values (
  (select id from public.visa_types where visaai_id = 'no-study-permit'),
  'likelihood_of_return', 'condition', true,
  'Your circumstances must indicate you are likely to return home after your studies', 'A decision criterion rather than a document. Recorded so it is visible rather than a surprise at refusal.',
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
    where s.source_url = 'https://www.udi.no/en/want-to-apply/studies/studietillatelse/'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'no-study-permit'))
    order by s.visa_type_id nulls last
    limit 1),
  'the circumstances in your home country must indicate that it is likely that you can return home when you have completed your studies.', 'manual', 1.00,
  'draft', 130, '2026-08-22'::timestamptz
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
  from (values ('https://www.udi.no/en/want-to-apply/studies/studietillatelse/')) as r(url)
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

commit;

-- 13 requirement(s): 12 condition, 1 fee
