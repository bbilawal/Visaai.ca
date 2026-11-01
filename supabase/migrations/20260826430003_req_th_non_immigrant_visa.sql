-- Requirements for th-non-immigrant-visa, extracted 2026-08-24.
--
-- GENERATED FILE. Do not hand-edit.
--   source: data/requirements/th-non-immigrant-visa.json
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
  (select id from public.visa_types where visaai_id = 'th-non-immigrant-visa'),
  'ten_lettered_purposes', 'condition', true,
  'Ten lettered purposes qualify for the non-immigrant visa', 'The letter is not a formality: it decides which additional documents are required and is chosen at application.',
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
    where s.source_url = 'https://consular.mfa.go.th/th/publicservice/%e0%b8%84%e0%b8%99%e0%b8%ad%e0%b8%a2%e0%b8%b9%e0%b9%88%e0%b8%8a%e0%b8%b1%e0%b9%88%e0%b8%a7%e0%b8%84%e0%b8%a3%e0%b8%b2%e0%b8%a7-%e0%b9%8cnon-immigrant-visa?page=5ddcb94a01330918812bbf22&menu=5ddcb8b29b1e8a30447d6f22'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'th-non-immigrant-visa'))
    order by s.visa_type_id nulls last
    limit 1),
  '• การปฏิบัติหน้าที่ทางราชการ (f) • การติดต่อหรือประกอบธุรกิจ และการทำงาน (b) • การลงทุนที่ได้รับความเห็นชอบจากกระทรวงที่เกี่ยวข้อง (im) • การลงทุนหรือการอื่นภายใต้ข้อบังคับกฎหมายว่าด้วยการส่งเสริมการลงทุน (ib) • การศึกษา ดูงาน และฝึกอบรมต่างๆ (ed) • การปฏิบัติหน้าที่สื่อมวลชน (m) • การเผยแผ่ศาสนาที่ได้รับความเห็นชอบจากกรมการศาสนา กระทรวงศึกษาธิการ (r) • การค้นคว้าทางวิทยาศาสตร์หรือฝึกสอนในสถาบันการค้นคว้า หรือสถาบันการศึกษาในราชอาณาจักร (rs) • การปฏิบัติงานด้านช่างฝีมือผู้เชี่ยวชาญ (ex) • การอื่น (o)', '• การปฏิบัติหน้าที่ทางราชการ (F) • การติดต่อหรือประกอบธุรกิจ และการทำงาน (B) • การลงทุนที่ได้รับความเห็นชอบจากกระทรวงที่เกี่ยวข้อง (IM) • การลงทุนหรือการอื่นภายใต้ข้อบังคับกฎหมายว่าด้วยการส่งเสริมการลงทุน (IB) • การศึกษา ดูงาน และฝึกอบรมต่างๆ (ED) • การปฏิบัติหน้าที่สื่อมวลชน (M) • การเผยแผ่ศาสนาที่ได้รับความเห็นชอบจากกรมการศาสนา กระทรวงศึกษาธิการ (R) • การค้นคว้าทางวิทยาศาสตร์หรือฝึกสอนในสถาบันการค้นคว้า หรือสถาบันการศึกษาในราชอาณาจักร (RS) • การปฏิบัติงานด้านช่างฝีมือผู้เชี่ยวชาญ (EX) • การอื่น (O)', 'manual', 1.00,
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
  (select id from public.visa_types where visaai_id = 'th-non-immigrant-visa'),
  'visa_validity', 'condition', true,
  'Visa validity: 3 months single entry, 12 months multiple entries', null,
  null, null,
  null, '{"single_entry_months":3,"multiple_entry_months":12}'::jsonb,
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
    where s.source_url = 'https://consular.mfa.go.th/th/publicservice/%e0%b8%84%e0%b8%99%e0%b8%ad%e0%b8%a2%e0%b8%b9%e0%b9%88%e0%b8%8a%e0%b8%b1%e0%b9%88%e0%b8%a7%e0%b8%84%e0%b8%a3%e0%b8%b2%e0%b8%a7-%e0%b9%8cnon-immigrant-visa?page=5ddcb94a01330918812bbf22&menu=5ddcb8b29b1e8a30447d6f22'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'th-non-immigrant-visa'))
    order by s.visa_type_id nulls last
    limit 1),
  'อายุวีซ่า 3 เดือน (single entries) 12 เดือน (multiple entries)', 'อายุวีซ่า 3 เดือน (Single Entries) 12 เดือน (Multiple Entries)', 'manual', 1.00,
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
  (select id from public.visa_types where visaai_id = 'th-non-immigrant-visa'),
  'stay_per_entry_90_days', 'condition', true,
  'Length of stay: 90 days per entry', null,
  null, null,
  null, '{"days_per_entry":90}'::jsonb,
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
    where s.source_url = 'https://consular.mfa.go.th/th/publicservice/%e0%b8%84%e0%b8%99%e0%b8%ad%e0%b8%a2%e0%b8%b9%e0%b9%88%e0%b8%8a%e0%b8%b1%e0%b9%88%e0%b8%a7%e0%b8%84%e0%b8%a3%e0%b8%b2%e0%b8%a7-%e0%b9%8cnon-immigrant-visa?page=5ddcb94a01330918812bbf22&menu=5ddcb8b29b1e8a30447d6f22'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'th-non-immigrant-visa'))
    order by s.visa_type_id nulls last
    limit 1),
  'ระยะเวลาพำนักในราชอาณาจักร 90 วัน ต่อครั้ง', 'ระยะเวลาพำนักในราชอาณาจักร 90 วัน ต่อครั้ง', 'manual', 1.00,
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
  (select id from public.visa_types where visaai_id = 'th-non-immigrant-visa'),
  'fee', 'fee', true,
  'Fee: THB 2,000 single entry, THB 5,000 multiple entries', null,
  null, null,
  null, '{"single_entry_thb":2000,"multiple_entry_thb":5000}'::jsonb,
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
    where s.source_url = 'https://consular.mfa.go.th/th/publicservice/%e0%b8%84%e0%b8%99%e0%b8%ad%e0%b8%a2%e0%b8%b9%e0%b9%88%e0%b8%8a%e0%b8%b1%e0%b9%88%e0%b8%a7%e0%b8%84%e0%b8%a3%e0%b8%b2%e0%b8%a7-%e0%b9%8cnon-immigrant-visa?page=5ddcb94a01330918812bbf22&menu=5ddcb8b29b1e8a30447d6f22'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'th-non-immigrant-visa'))
    order by s.visa_type_id nulls last
    limit 1),
  'ค่าธรรมเนียม 2,000 บาท (single entries) 5,000 บาท (multiple entries)', 'ค่าธรรมเนียม 2,000 บาท (Single Entries) 5,000 บาท (Multiple Entries)', 'manual', 1.00,
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
  (select id from public.visa_types where visaai_id = 'th-non-immigrant-visa'),
  'funds_carried', 'condition', true,
  'Funds to be carried: THB 20,000 per person, THB 40,000 per family', null,
  null, null,
  null, '{"per_person_thb":20000,"per_family_thb":40000}'::jsonb,
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
    where s.source_url = 'https://consular.mfa.go.th/th/publicservice/%e0%b8%84%e0%b8%99%e0%b8%ad%e0%b8%a2%e0%b8%b9%e0%b9%88%e0%b8%8a%e0%b8%b1%e0%b9%88%e0%b8%a7%e0%b8%84%e0%b8%a3%e0%b8%b2%e0%b8%a7-%e0%b9%8cnon-immigrant-visa?page=5ddcb94a01330918812bbf22&menu=5ddcb8b29b1e8a30447d6f22'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'th-non-immigrant-visa'))
    order by s.visa_type_id nulls last
    limit 1),
  'จำนวนเงินติดตัว* 20,000 บาท / คน 40,000 บาท / ครอบครัว', 'จำนวนเงินติดตัว* 20,000 บาท / คน 40,000 บาท / ครอบครัว', 'manual', 1.00,
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
  (select id from public.visa_types where visaai_id = 'th-non-immigrant-visa'),
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
    where s.source_url = 'https://consular.mfa.go.th/th/publicservice/%e0%b8%84%e0%b8%99%e0%b8%ad%e0%b8%a2%e0%b8%b9%e0%b9%88%e0%b8%8a%e0%b8%b1%e0%b9%88%e0%b8%a7%e0%b8%84%e0%b8%a3%e0%b8%b2%e0%b8%a7-%e0%b9%8cnon-immigrant-visa?page=5ddcb94a01330918812bbf22&menu=5ddcb8b29b1e8a30447d6f22'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'th-non-immigrant-visa'))
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
  (select id from public.visa_types where visaai_id = 'th-non-immigrant-visa'),
  'work_b_requires_labour_ministry_letter', 'evidence', true,
  'For work (B): a letter from the Department of Employment, Ministry of Labour, notifying approval for the foreign national to work at the company', 'A TWO-AUTHORITY ROUTE. The Ministry of Labour decides whether the person may work; the MFA then issues the visa. Applying to the consulate first does not work.',
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
    where s.source_url = 'https://consular.mfa.go.th/th/publicservice/%e0%b8%84%e0%b8%99%e0%b8%ad%e0%b8%a2%e0%b8%b9%e0%b9%88%e0%b8%8a%e0%b8%b1%e0%b9%88%e0%b8%a7%e0%b8%84%e0%b8%a3%e0%b8%b2%e0%b8%a7-%e0%b9%8cnon-immigrant-visa?page=5ddcb94a01330918812bbf22&menu=5ddcb8b29b1e8a30447d6f22'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'th-non-immigrant-visa'))
    order by s.visa_type_id nulls last
    limit 1),
  '• สำหรับ (b) ทำงาน - หนังสือกรมการจัดหางาน กระทรวงแรงงาน แจ้งผลการพิจารณาอนุญาตให้คนต่างด้าวเข้ามาทำงานในบริษัทฯ', '• สำหรับ (B) ทำงาน - หนังสือกรมการจัดหางาน กระทรวงแรงงาน แจ้งผลการพิจารณาอนุญาตให้คนต่างด้าวเข้ามาทำงานในบริษัทฯ', 'manual', 1.00,
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
  (select id from public.visa_types where visaai_id = 'th-non-immigrant-visa'),
  'study_ed_requires_acceptance_letter', 'evidence', true,
  'For study (ED): a letter of acceptance from the educational institution', null,
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
    where s.source_url = 'https://consular.mfa.go.th/th/publicservice/%e0%b8%84%e0%b8%99%e0%b8%ad%e0%b8%a2%e0%b8%b9%e0%b9%88%e0%b8%8a%e0%b8%b1%e0%b9%88%e0%b8%a7%e0%b8%84%e0%b8%a3%e0%b8%b2%e0%b8%a7-%e0%b9%8cnon-immigrant-visa?page=5ddcb94a01330918812bbf22&menu=5ddcb8b29b1e8a30447d6f22'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'th-non-immigrant-visa'))
    order by s.visa_type_id nulls last
    limit 1),
  '• สำหรับ (ed) นักเรียน / นักศึกษา - หนังสือตอบรับจากสถานศึกษา', '• สำหรับ (ED) นักเรียน / นักศึกษา - หนังสือตอบรับจากสถานศึกษา', 'manual', 1.00,
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
  (select id from public.visa_types where visaai_id = 'th-non-immigrant-visa'),
  'buddhist_study_requires_national_office_permission', 'evidence', true,
  'For study (ED) by a monk studying Buddhism: permission from the National Office of Buddhism', null,
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
    where s.source_url = 'https://consular.mfa.go.th/th/publicservice/%e0%b8%84%e0%b8%99%e0%b8%ad%e0%b8%a2%e0%b8%b9%e0%b9%88%e0%b8%8a%e0%b8%b1%e0%b9%88%e0%b8%a7%e0%b8%84%e0%b8%a3%e0%b8%b2%e0%b8%a7-%e0%b9%8cnon-immigrant-visa?page=5ddcb94a01330918812bbf22&menu=5ddcb8b29b1e8a30447d6f22'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'th-non-immigrant-visa'))
    order by s.visa_type_id nulls last
    limit 1),
  '• สำหรับ (ed) นักบวชที่จะเข้ามาศึกษาพระพุทธศาสนา - หนังสืออนุญาตจากสำนักงานพระพุทธศาสนาแห่งชาติ', '• สำหรับ (ED) นักบวชที่จะเข้ามาศึกษาพระพุทธศาสนา - หนังสืออนุญาตจากสำนักงานพระพุทธศาสนาแห่งชาติ', 'manual', 1.00,
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
  (select id from public.visa_types where visaai_id = 'th-non-immigrant-visa'),
  'retirement_o_requires_age_50_and_no_work', 'condition', true,
  'For retirement (O): the applicant must be at least 50 years old, must state the purpose is to retire, and must not work while in Thailand', 'Three conditions in one line, and the third is a continuing undertaking rather than an application statement.',
  null, null,
  null, '{"minimum_age":50}'::jsonb,
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
    where s.source_url = 'https://consular.mfa.go.th/th/publicservice/%e0%b8%84%e0%b8%99%e0%b8%ad%e0%b8%a2%e0%b8%b9%e0%b9%88%e0%b8%8a%e0%b8%b1%e0%b9%88%e0%b8%a7%e0%b8%84%e0%b8%a3%e0%b8%b2%e0%b8%a7-%e0%b9%8cnon-immigrant-visa?page=5ddcb94a01330918812bbf22&menu=5ddcb8b29b1e8a30447d6f22'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'th-non-immigrant-visa'))
    order by s.visa_type_id nulls last
    limit 1),
  '- ผู้ร้องต้องมีอายุตั้งแต่ 50 ปีบริบูรณ์ขึ้นไป ระบุวัตถุประสงค์ว่าจะขอเข้ามาใช้ชีวิตในฐานะผู้สูงอายุหรือเกษียณ และจะไม่ทำงานในระหว่างพำนักในไทย', '- ผู้ร้องต้องมีอายุตั้งแต่ 50 ปีบริบูรณ์ขึ้นไป ระบุวัตถุประสงค์ว่าจะขอเข้ามาใช้ชีวิตในฐานะผู้สูงอายุหรือเกษียณ และจะไม่ทำงานในระหว่างพำนักในไทย', 'manual', 1.00,
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

insert into public.visa_requirements (
  visa_type_id, requirement_code, kind, officially_required, label, description,
  official_form_code, official_form_url, rule, parameters,
  source_version_id, source_excerpt, source_excerpt_display, extraction_method, confidence,
  status, display_order, last_verified_at
) values (
  (select id from public.visa_types where visaai_id = 'th-non-immigrant-visa'),
  'medical_treatment_o_requires_hospital_letter', 'evidence', true,
  'For medical treatment (O): a letter of acceptance from a hospital accredited by a Thai government agency', null,
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
    where s.source_url = 'https://consular.mfa.go.th/th/publicservice/%e0%b8%84%e0%b8%99%e0%b8%ad%e0%b8%a2%e0%b8%b9%e0%b9%88%e0%b8%8a%e0%b8%b1%e0%b9%88%e0%b8%a7%e0%b8%84%e0%b8%a3%e0%b8%b2%e0%b8%a7-%e0%b9%8cnon-immigrant-visa?page=5ddcb94a01330918812bbf22&menu=5ddcb8b29b1e8a30447d6f22'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'th-non-immigrant-visa'))
    order by s.visa_type_id nulls last
    limit 1),
  '• สำหรับ (o) เข้ามาเพื่อรับการรักษาพยาบาล - หนังสือตอบรับจากสถานพยาบาลที่ได้รับการรับรองจากหน่วยงานของรัฐในประเทศไทย', '• สำหรับ (O) เข้ามาเพื่อรับการรักษาพยาบาล - หนังสือตอบรับจากสถานพยาบาลที่ได้รับการรับรองจากหน่วยงานของรัฐในประเทศไทย', 'manual', 1.00,
  'draft', 110, '2026-08-24'::timestamptz
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
  (select id from public.visa_types where visaai_id = 'th-non-immigrant-visa'),
  'court_witness_o_requires_court_summons', 'evidence', true,
  'For being a party or witness in court (O): a letter or summons from a Thai court', null,
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
    where s.source_url = 'https://consular.mfa.go.th/th/publicservice/%e0%b8%84%e0%b8%99%e0%b8%ad%e0%b8%a2%e0%b8%b9%e0%b9%88%e0%b8%8a%e0%b8%b1%e0%b9%88%e0%b8%a7%e0%b8%84%e0%b8%a3%e0%b8%b2%e0%b8%a7-%e0%b9%8cnon-immigrant-visa?page=5ddcb94a01330918812bbf22&menu=5ddcb8b29b1e8a30447d6f22'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'th-non-immigrant-visa'))
    order by s.visa_type_id nulls last
    limit 1),
  '• สำหรับ (o) คู่ความหรือพยานในศาล - หนังสือหรือหมายจากศาลของไทย', '• สำหรับ (O) คู่ความหรือพยานในศาล - หนังสือหรือหมายจากศาลของไทย', 'manual', 1.00,
  'draft', 120, '2026-08-24'::timestamptz
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
  (select id from public.visa_types where visaai_id = 'th-non-immigrant-visa'),
  'dependant_o_evidence', 'evidence', true,
  'For dependants (O): proof of the family relationship, the Thai-based worker’s employment certificate and valid work permit, and proof the spouse is Thai or a resident of the Kingdom', null,
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
    where s.source_url = 'https://consular.mfa.go.th/th/publicservice/%e0%b8%84%e0%b8%99%e0%b8%ad%e0%b8%a2%e0%b8%b9%e0%b9%88%e0%b8%8a%e0%b8%b1%e0%b9%88%e0%b8%a7%e0%b8%84%e0%b8%a3%e0%b8%b2%e0%b8%a7-%e0%b9%8cnon-immigrant-visa?page=5ddcb94a01330918812bbf22&menu=5ddcb8b29b1e8a30447d6f22'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'th-non-immigrant-visa'))
    order by s.visa_type_id nulls last
    limit 1),
  '- หลักฐานการเป็นบิดา มารดา บุตร / สูติบัตร / ใบสำคัญการสมรส - หนังสือรับรองการทำงาน ใบอนุญาตทำงานที่ยังมีอายุใช้งาน ของผู้ที่ทำงานในประเทศไทย', '- หลักฐานการเป็นบิดา มารดา บุตร / สูติบัตร / ใบสำคัญการสมรส - หนังสือรับรองการทำงาน ใบอนุญาตทำงานที่ยังมีอายุใช้งาน ของผู้ที่ทำงานในประเทศไทย', 'manual', 1.00,
  'draft', 130, '2026-08-24'::timestamptz
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
  from (values ('https://consular.mfa.go.th/th/publicservice/%e0%b8%84%e0%b8%99%e0%b8%ad%e0%b8%a2%e0%b8%b9%e0%b9%88%e0%b8%8a%e0%b8%b1%e0%b9%88%e0%b8%a7%e0%b8%84%e0%b8%a3%e0%b8%b2%e0%b8%a7-%e0%b9%8cnon-immigrant-visa?page=5ddcb94a01330918812bbf22&menu=5ddcb8b29b1e8a30447d6f22')) as r(url)
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

-- 13 requirement(s): 5 condition, 1 fee, 7 evidence
