-- Requirements for pt-trabalho-visto-procura-emprego, extracted 2026-08-24.
--
-- GENERATED FILE. Do not hand-edit.
--   source: data/requirements/pt-trabalho-visto-procura-emprego.json
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
--   * Everything about obtaining the residence VISA that several routes require. Published on vistos.mne.gov.pt, which resets our connection from the production address and answers 200 from a second egress. Not registered, not read.
--   * The fees. Every page links a single fee schedule rather than stating amounts.
--   * Processing times. Not stated on any page.
--   * How to prove means of subsistence. The pages link Portaria n.º 1563/2007 rather than stating a figure.

begin;

insert into public.visa_requirements (
  visa_type_id, requirement_code, kind, officially_required, label, description,
  official_form_code, official_form_url, rule, parameters,
  source_version_id, source_excerpt, source_excerpt_display, extraction_method, confidence,
  status, display_order, last_verified_at
) values (
  (select id from public.visa_types where visaai_id = 'pt-trabalho-visto-procura-emprego'),
  'who_the_route_is_for', 'condition', true,
  'For employed workers who hold a job-seeker visa and have already formed or formalised the employment relationship', null,
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
    where s.source_url = 'https://aima.gov.pt/pt/trabalhar/autorizacao-de-residencia-para-exercicio-de-atividade-profissional-subordinada-com-visto-para-procura-de-trabalho-art-88-o-n-o7'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'pt-trabalho-visto-procura-emprego'))
    order by s.visa_type_id nulls last
    limit 1),
  'autorização de residência para trabalhadores subordinados/ por conta de outrem que que possuam visto para procura de trabalho e que já tenham constituído ou formalizado a relação laboral e pretendam procurar trabalho em portugal.', 'Autorização de residência para trabalhadores subordinados/ por conta de outrem que que possuam visto para procura de trabalho e que já tenham constituído ou formalizado a relação laboral e pretendam procurar trabalho em Portugal.', 'manual', 1.00,
  'draft', 10, '2026-08-24'::timestamptz
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
  (select id from public.visa_types where visaai_id = 'pt-trabalho-visto-procura-emprego'),
  'visa_validity_120_days_with_appointment', 'condition', true,
  'The job-seeker visa is valid 120 days and includes a booked appointment with the permit service inside that validity', 'The appointment is part of the visa. Missing it is not a rescheduling problem, it runs against a 120-day clock.',
  null, null,
  null, '{"visa_validity_days":120}'::jsonb,
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
    where s.source_url = 'https://aima.gov.pt/pt/trabalhar/autorizacao-de-residencia-para-exercicio-de-atividade-profissional-subordinada-com-visto-para-procura-de-trabalho-art-88-o-n-o7'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'pt-trabalho-visto-procura-emprego'))
    order by s.visa_type_id nulls last
    limit 1),
  'o visto para procura de trabalho integra uma data de agendamento nos serviços competentes pela concessão de autorização de residência, dentro da validade do visto (120 dias).', 'O visto para procura de trabalho integra uma data de agendamento nos serviços competentes pela concessão de autorização de residência, dentro da validade do visto (120 dias).', 'manual', 1.00,
  'draft', 20, '2026-08-24'::timestamptz
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
  (select id from public.visa_types where visaai_id = 'pt-trabalho-visto-procura-emprego'),
  'may_work_before_the_permit_is_granted', 'condition', false,
  'The visa holder may carry on employed work until the visa expires or until the permit is granted', 'A right that exists before the permit does.',
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
    where s.source_url = 'https://aima.gov.pt/pt/trabalhar/autorizacao-de-residencia-para-exercicio-de-atividade-profissional-subordinada-com-visto-para-procura-de-trabalho-art-88-o-n-o7'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'pt-trabalho-visto-procura-emprego'))
    order by s.visa_type_id nulls last
    limit 1),
  'o titular do visto para procura de trabalho pode exercer uma atividade laboral dependente até ao termo da duração do visto ou até à concessão da respetiva autorização de residência.', 'O titular do visto para procura de trabalho pode exercer uma atividade laboral dependente até ao termo da duração do visto ou até à concessão da respetiva autorização de residência.', 'manual', 1.00,
  'draft', 30, '2026-08-24'::timestamptz
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
  (select id from public.visa_types where visaai_id = 'pt-trabalho-visto-procura-emprego'),
  'valid_job_seeker_visa', 'evidence', true,
  'A valid job-seeker visa', null,
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
    where s.source_url = 'https://aima.gov.pt/pt/trabalhar/autorizacao-de-residencia-para-exercicio-de-atividade-profissional-subordinada-com-visto-para-procura-de-trabalho-art-88-o-n-o7'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'pt-trabalho-visto-procura-emprego'))
    order by s.visa_type_id nulls last
    limit 1),
  'visto para procura de trabalho válido;', 'Visto para procura de trabalho válido;', 'manual', 1.00,
  'draft', 40, '2026-08-24'::timestamptz
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
  (select id from public.visa_types where visaai_id = 'pt-trabalho-visto-procura-emprego'),
  'employer_sworn_declaration', 'evidence', true,
  'A sworn declaration from the employer attesting the employment relationship', null,
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
    where s.source_url = 'https://aima.gov.pt/pt/trabalhar/autorizacao-de-residencia-para-exercicio-de-atividade-profissional-subordinada-com-visto-para-procura-de-trabalho-art-88-o-n-o7'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'pt-trabalho-visto-procura-emprego'))
    order by s.visa_type_id nulls last
    limit 1),
  'declaração sob compromisso de honra da entidade patronal atestando o vínculo laboral ;', 'Declaração sob compromisso de honra da Entidade Patronal atestando o vínculo laboral;', 'manual', 1.00,
  'draft', 50, '2026-08-24'::timestamptz
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
  (select id from public.visa_types where visaai_id = 'pt-trabalho-visto-procura-emprego'),
  'validity_two_years_renewable_three', 'condition', true,
  'The permit is valid 2 years from issue, renewable for successive 3-year periods', null,
  null, null,
  null, '{"initial_years":2,"renewal_years":3}'::jsonb,
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
    where s.source_url = 'https://aima.gov.pt/pt/trabalhar/autorizacao-de-residencia-para-exercicio-de-atividade-profissional-subordinada-com-visto-para-procura-de-trabalho-art-88-o-n-o7'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'pt-trabalho-visto-procura-emprego'))
    order by s.visa_type_id nulls last
    limit 1),
  'a autorização de residência temporária para o exercício de uma atividade profissional é válida pelo período de dois anos contados a partir da data da emissão do respetivo título e é renovável por períodos sucessivos de três anos.', 'A autorização de residência temporária para o exercício de uma atividade profissional é válida pelo período de dois anos contados a partir da data da emissão do respetivo título e é renovável por períodos sucessivos de três anos.', 'manual', 1.00,
  'draft', 60, '2026-08-24'::timestamptz
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
  from (values ('https://aima.gov.pt/pt/trabalhar/autorizacao-de-residencia-para-exercicio-de-atividade-profissional-subordinada-com-visto-para-procura-de-trabalho-art-88-o-n-o7')) as r(url)
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

-- 6 requirement(s): 4 condition, 2 evidence
