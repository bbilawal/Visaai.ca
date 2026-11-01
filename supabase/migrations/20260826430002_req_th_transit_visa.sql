-- Requirements for th-transit-visa, extracted 2026-08-24.
--
-- GENERATED FILE. Do not hand-edit.
--   source: data/requirements/th-transit-visa.json
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
--   * Everything the Immigration Bureau decides: admission at the border, extension of stay, and change of visa type. The page states plainly that these are applied for at the Immigration Bureau and are at the officer's discretion, and www.immigration.go.th returns 403 to our monitor.
--   * Which nationalities are visa-exempt or eligible for visa on arrival. The department publishes separate lists for both, and neither is registered here.
--   * The e-Visa application procedure. Operated at www.thaievisa.go.th, whose pages serve zero characters server-side.
--   * Processing times. Not stated on the page.

begin;

insert into public.visa_requirements (
  visa_type_id, requirement_code, kind, officially_required, label, description,
  official_form_code, official_form_url, rule, parameters,
  source_version_id, source_excerpt, source_excerpt_display, extraction_method, confidence,
  status, display_order, last_verified_at
) values (
  (select id from public.visa_types where visaai_id = 'th-transit-visa'),
  'three_qualifying_purposes', 'condition', true,
  'Three qualifying purposes: transit through the Kingdom (TS), sports participation (S), and being in charge of or crew of a vehicle arriving at a port, station or locality in the Kingdom (C)', null,
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
    where s.source_url = 'https://consular.mfa.go.th/th/publicservice/%e0%b8%84%e0%b8%99%e0%b9%80%e0%b8%94%e0%b8%b4%e0%b8%99%e0%b8%97%e0%b8%b2%e0%b8%87%e0%b8%9c%e0%b9%88%e0%b8%b2%e0%b8%99%e0%b8%a3%e0%b8%b2%e0%b8%8a%e0%b8%ad%e0%b8%b2%e0%b8%93%e0%b8%b2%e0%b8%88%e0%b8%b1%e0%b8%81%e0%b8%a3-transit-visa?page=5ddcb94a01330918812bbf22&menu=5ddcb8b29b1e8a30447d6f22'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'th-transit-visa'))
    order by s.visa_type_id nulls last
    limit 1),
  'เพื่อเดินทางผ่านราชอาณาจักร (ts) เพื่อเล่นกีฬา (s) เป็นผู้ควบคุมพาหนะหรือเป็นคนประจำพาหนะที่เข้ามายังท่า สถานี หรือท้องที่ในราชอาณาจักร (c)', 'เพื่อเดินทางผ่านราชอาณาจักร (TS) เพื่อเล่นกีฬา (S) เป็นผู้ควบคุมพาหนะหรือเป็นคนประจำพาหนะที่เข้ามายังท่า สถานี หรือท้องที่ในราชอาณาจักร (C)', 'manual', 1.00,
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
  (select id from public.visa_types where visaai_id = 'th-transit-visa'),
  'visa_validity_three_months', 'condition', true,
  'Visa validity: 3 months', null,
  null, null,
  null, '{"months":3}'::jsonb,
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
    where s.source_url = 'https://consular.mfa.go.th/th/publicservice/%e0%b8%84%e0%b8%99%e0%b9%80%e0%b8%94%e0%b8%b4%e0%b8%99%e0%b8%97%e0%b8%b2%e0%b8%87%e0%b8%9c%e0%b9%88%e0%b8%b2%e0%b8%99%e0%b8%a3%e0%b8%b2%e0%b8%8a%e0%b8%ad%e0%b8%b2%e0%b8%93%e0%b8%b2%e0%b8%88%e0%b8%b1%e0%b8%81%e0%b8%a3-transit-visa?page=5ddcb94a01330918812bbf22&menu=5ddcb8b29b1e8a30447d6f22'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'th-transit-visa'))
    order by s.visa_type_id nulls last
    limit 1),
  'อายุวีซ่า 3 เดือน', 'อายุวีซ่า 3 เดือน', 'manual', 1.00,
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
  (select id from public.visa_types where visaai_id = 'th-transit-visa'),
  'stay_per_entry_30_days', 'condition', true,
  'Length of stay: 30 days per entry', null,
  null, null,
  null, '{"days_per_entry":30}'::jsonb,
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
    where s.source_url = 'https://consular.mfa.go.th/th/publicservice/%e0%b8%84%e0%b8%99%e0%b9%80%e0%b8%94%e0%b8%b4%e0%b8%99%e0%b8%97%e0%b8%b2%e0%b8%87%e0%b8%9c%e0%b9%88%e0%b8%b2%e0%b8%99%e0%b8%a3%e0%b8%b2%e0%b8%8a%e0%b8%ad%e0%b8%b2%e0%b8%93%e0%b8%b2%e0%b8%88%e0%b8%b1%e0%b8%81%e0%b8%a3-transit-visa?page=5ddcb94a01330918812bbf22&menu=5ddcb8b29b1e8a30447d6f22'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'th-transit-visa'))
    order by s.visa_type_id nulls last
    limit 1),
  'ระยะเวลาพำนักในราชอาณาจักร 30 วัน ต่อครั้ง', 'ระยะเวลาพำนักในราชอาณาจักร 30 วัน ต่อครั้ง', 'manual', 1.00,
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
  (select id from public.visa_types where visaai_id = 'th-transit-visa'),
  'fee', 'fee', true,
  'Fee: THB 800, for up to 4 entries', null,
  null, null,
  null, '{"fee_thb":800,"max_entries":4}'::jsonb,
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
    where s.source_url = 'https://consular.mfa.go.th/th/publicservice/%e0%b8%84%e0%b8%99%e0%b9%80%e0%b8%94%e0%b8%b4%e0%b8%99%e0%b8%97%e0%b8%b2%e0%b8%87%e0%b8%9c%e0%b9%88%e0%b8%b2%e0%b8%99%e0%b8%a3%e0%b8%b2%e0%b8%8a%e0%b8%ad%e0%b8%b2%e0%b8%93%e0%b8%b2%e0%b8%88%e0%b8%b1%e0%b8%81%e0%b8%a3-transit-visa?page=5ddcb94a01330918812bbf22&menu=5ddcb8b29b1e8a30447d6f22'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'th-transit-visa'))
    order by s.visa_type_id nulls last
    limit 1),
  'ค่าธรรมเนียม 800 บาท (ไม่เกิน 4 ครั้ง)', 'ค่าธรรมเนียม 800 บาท (ไม่เกิน 4 ครั้ง)', 'manual', 1.00,
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
  (select id from public.visa_types where visaai_id = 'th-transit-visa'),
  'funds_carried', 'condition', true,
  'Funds to be carried: THB 10,000 per person, THB 20,000 per family', 'Half the tourist visa figures, and the difference is easy to carry across wrongly.',
  null, null,
  null, '{"per_person_thb":10000,"per_family_thb":20000}'::jsonb,
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
    where s.source_url = 'https://consular.mfa.go.th/th/publicservice/%e0%b8%84%e0%b8%99%e0%b9%80%e0%b8%94%e0%b8%b4%e0%b8%99%e0%b8%97%e0%b8%b2%e0%b8%87%e0%b8%9c%e0%b9%88%e0%b8%b2%e0%b8%99%e0%b8%a3%e0%b8%b2%e0%b8%8a%e0%b8%ad%e0%b8%b2%e0%b8%93%e0%b8%b2%e0%b8%88%e0%b8%b1%e0%b8%81%e0%b8%a3-transit-visa?page=5ddcb94a01330918812bbf22&menu=5ddcb8b29b1e8a30447d6f22'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'th-transit-visa'))
    order by s.visa_type_id nulls last
    limit 1),
  'จำนวนเงินติดตัว* 10,000 บาท / คน 20,000 บาท / ครอบครัว', 'จำนวนเงินติดตัว* 10,000 บาท / คน 20,000 บาท / ครอบครัว', 'manual', 1.00,
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
  (select id from public.visa_types where visaai_id = 'th-transit-visa'),
  'passport_validity_six_months', 'evidence', true,
  'Passport or travel document valid for at least 6 months', null,
  null, null,
  null, '{"passport_validity_months":6}'::jsonb,
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
    where s.source_url = 'https://consular.mfa.go.th/th/publicservice/%e0%b8%84%e0%b8%99%e0%b9%80%e0%b8%94%e0%b8%b4%e0%b8%99%e0%b8%97%e0%b8%b2%e0%b8%87%e0%b8%9c%e0%b9%88%e0%b8%b2%e0%b8%99%e0%b8%a3%e0%b8%b2%e0%b8%8a%e0%b8%ad%e0%b8%b2%e0%b8%93%e0%b8%b2%e0%b8%88%e0%b8%b1%e0%b8%81%e0%b8%a3-transit-visa?page=5ddcb94a01330918812bbf22&menu=5ddcb8b29b1e8a30447d6f22'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'th-transit-visa'))
    order by s.visa_type_id nulls last
    limit 1),
  '• หนังสือเดินทางหรือเอกสารใช้แทนหนังสือเดินทาง อายุใช้งานไม่น้อยกว่า 6 เดือน', '• หนังสือเดินทางหรือเอกสารใช้แทนหนังสือเดินทาง อายุใช้งานไม่น้อยกว่า 6 เดือน', 'manual', 1.00,
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

insert into public.visa_requirements (
  visa_type_id, requirement_code, kind, officially_required, label, description,
  official_form_code, official_form_url, rule, parameters,
  source_version_id, source_excerpt, source_excerpt_display, extraction_method, confidence,
  status, display_order, last_verified_at
) values (
  (select id from public.visa_types where visaai_id = 'th-transit-visa'),
  'ts_third_country_visa', 'evidence', true,
  'For transit (TS): the third country’s visa in your passport or travel document', null,
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
    where s.source_url = 'https://consular.mfa.go.th/th/publicservice/%e0%b8%84%e0%b8%99%e0%b9%80%e0%b8%94%e0%b8%b4%e0%b8%99%e0%b8%97%e0%b8%b2%e0%b8%87%e0%b8%9c%e0%b9%88%e0%b8%b2%e0%b8%99%e0%b8%a3%e0%b8%b2%e0%b8%8a%e0%b8%ad%e0%b8%b2%e0%b8%93%e0%b8%b2%e0%b8%88%e0%b8%b1%e0%b8%81%e0%b8%a3-transit-visa?page=5ddcb94a01330918812bbf22&menu=5ddcb8b29b1e8a30447d6f22'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'th-transit-visa'))
    order by s.visa_type_id nulls last
    limit 1),
  '• สำหรับ (ts) วีซ่าของประเทศที่สามในหนังสือเดินทางหรือเอกสารใช้แทนหนังสือเดินทาง', '• สำหรับ (TS) วีซ่าของประเทศที่สามในหนังสือเดินทางหรือเอกสารใช้แทนหนังสือเดินทาง', 'manual', 1.00,
  'draft', 70, '2026-08-24'::timestamptz
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
  (select id from public.visa_types where visaai_id = 'th-transit-visa'),
  's_sports_invitation', 'evidence', true,
  'For sports (S): a letter inviting you to take part in the sporting competition', null,
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
    where s.source_url = 'https://consular.mfa.go.th/th/publicservice/%e0%b8%84%e0%b8%99%e0%b9%80%e0%b8%94%e0%b8%b4%e0%b8%99%e0%b8%97%e0%b8%b2%e0%b8%87%e0%b8%9c%e0%b9%88%e0%b8%b2%e0%b8%99%e0%b8%a3%e0%b8%b2%e0%b8%8a%e0%b8%ad%e0%b8%b2%e0%b8%93%e0%b8%b2%e0%b8%88%e0%b8%b1%e0%b8%81%e0%b8%a3-transit-visa?page=5ddcb94a01330918812bbf22&menu=5ddcb8b29b1e8a30447d6f22'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'th-transit-visa'))
    order by s.visa_type_id nulls last
    limit 1),
  '• สำหรับ (s) หนังสือเชิญให้เข้าร่วมในการแข่งขันกีฬา', '• สำหรับ (S) หนังสือเชิญให้เข้าร่วมในการแข่งขันกีฬา', 'manual', 1.00,
  'draft', 80, '2026-08-24'::timestamptz
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
  (select id from public.visa_types where visaai_id = 'th-transit-visa'),
  'c_crew_certificate', 'evidence', true,
  'For crew (C): a certificate that you are in charge of or crew of the vehicle', null,
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
    where s.source_url = 'https://consular.mfa.go.th/th/publicservice/%e0%b8%84%e0%b8%99%e0%b9%80%e0%b8%94%e0%b8%b4%e0%b8%99%e0%b8%97%e0%b8%b2%e0%b8%87%e0%b8%9c%e0%b9%88%e0%b8%b2%e0%b8%99%e0%b8%a3%e0%b8%b2%e0%b8%8a%e0%b8%ad%e0%b8%b2%e0%b8%93%e0%b8%b2%e0%b8%88%e0%b8%b1%e0%b8%81%e0%b8%a3-transit-visa?page=5ddcb94a01330918812bbf22&menu=5ddcb8b29b1e8a30447d6f22'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'th-transit-visa'))
    order by s.visa_type_id nulls last
    limit 1),
  '• สำหรับ (c) หนังสือรับรองว่าเป็นผู้ควบคุมพาหนะหรือเป็นคนประจำพาหนะที่เข้ามายังท่า สถานี หรือท้องที่ในราชอาณาจักร', '• สำหรับ (C) หนังสือรับรองว่าเป็นผู้ควบคุมพาหนะหรือเป็นคนประจำพาหนะที่เข้ามายังท่า สถานี หรือท้องที่ในราชอาณาจักร', 'manual', 1.00,
  'draft', 90, '2026-08-24'::timestamptz
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
  (select id from public.visa_types where visaai_id = 'th-transit-visa'),
  'air_ticket_required', 'evidence', true,
  'A return air ticket, or a ticket onward to a third country', null,
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
    where s.source_url = 'https://consular.mfa.go.th/th/publicservice/%e0%b8%84%e0%b8%99%e0%b9%80%e0%b8%94%e0%b8%b4%e0%b8%99%e0%b8%97%e0%b8%b2%e0%b8%87%e0%b8%9c%e0%b9%88%e0%b8%b2%e0%b8%99%e0%b8%a3%e0%b8%b2%e0%b8%8a%e0%b8%ad%e0%b8%b2%e0%b8%93%e0%b8%b2%e0%b8%88%e0%b8%b1%e0%b8%81%e0%b8%a3-transit-visa?page=5ddcb94a01330918812bbf22&menu=5ddcb8b29b1e8a30447d6f22'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'th-transit-visa'))
    order by s.visa_type_id nulls last
    limit 1),
  '• บัตรโดยสารเครื่องบิน ไป-กลับ หรือที่จะเดินทางไปยังประเทศที่สาม', '• บัตรโดยสารเครื่องบิน ไป-กลับ หรือที่จะเดินทางไปยังประเทศที่สาม', 'manual', 1.00,
  'draft', 100, '2026-08-24'::timestamptz
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
  from (values ('https://consular.mfa.go.th/th/publicservice/%e0%b8%84%e0%b8%99%e0%b9%80%e0%b8%94%e0%b8%b4%e0%b8%99%e0%b8%97%e0%b8%b2%e0%b8%87%e0%b8%9c%e0%b9%88%e0%b8%b2%e0%b8%99%e0%b8%a3%e0%b8%b2%e0%b8%8a%e0%b8%ad%e0%b8%b2%e0%b8%93%e0%b8%b2%e0%b8%88%e0%b8%b1%e0%b8%81%e0%b8%a3-transit-visa?page=5ddcb94a01330918812bbf22&menu=5ddcb8b29b1e8a30447d6f22')) as r(url)
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

-- 10 requirement(s): 4 condition, 1 fee, 5 evidence
