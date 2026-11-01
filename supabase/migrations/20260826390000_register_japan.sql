-- Japan: admitted on the Immigration Services Agency, after MOFA's refusal was
-- read as the country's answer.
--
-- WHAT WAS TRUE AND STAYS TRUE
--
-- www.mofa.go.jp returns HTTP 403 on robots.txt from the VPS. We cannot read
-- what it permits, so we stop, and it is not registered. MOFA holds the visa
-- catalogue and issues the visa itself.
--
-- WHAT WAS WRONG
--
-- The earlier passes also probed the Immigration Services Agency and recorded
-- "NAVIGATION SHELL" twice — 3,402 characters at /isa/index.html and 2,402 at
-- /isa/applications/status/index.html, no requirement markers. Both readings
-- were accurate and both were of INDEX pages. The index at
-- /isa/applications/status/ IS a shell; it is a shell listing 27 numbered
-- residence statuses, each on its own page, at 2,000 to 18,500 characters.
--
-- This is the Ireland failure exactly: stop at a 2,717-character router and
-- miss the 16,600-character page one link below it. The fix is the same rule —
-- enumerate the host, do not judge it by its landing page.
--
-- RULE 24 IS SATISFIED, NOT WAIVED. Admission needs pages that read AND an
-- index that enumerates. /isa/applications/status/index.html enumerates all 27
-- statuses by name and number, and every URL below was read off it.
--
-- THE LANGUAGE QUESTION IS SETTLED, AND SWEDEN SETTLED IT
--
-- These pages are Japanese. The first pass left this open as a product
-- question — every requirement VisaAI publishes is a verbatim excerpt, so
-- admitting Japan means publishing Japanese text to English readers. Sweden is
-- already live on Migrationsverket's Swedish tree with English labels marked as
-- translations, and the same shape applies here: official_name is the page's own
-- H1 in Japanese, and the English in each requirement's label is ours and is
-- labelled as ours. What was actually missing in the earlier passes was not a
-- decision about language, it was a page with requirements on it.
--
-- THIRTEEN OF TWENTY-SEVEN ARE REGISTERED
--
-- Nineteen of the 27 status pages carry 5,000 characters or more. Thirteen are
-- registered here. The remainder are named in the coverage exceptions ledger as
-- enumerated-but-not-extracted, which is the honest shape: the catalogue is
-- known and published, the extraction is partial and says so. Registering all
-- 27 empty would read as coverage from a distance.
--
-- 短期滞在 (Temporary Visitor) is registered DESPITE being thin at 4,105
-- characters, because it is the route most people arrive on and its thinness is
-- itself the finding: ISA publishes the status, MOFA publishes how to get the
-- visa, and MOFA refuses us.
--
-- REGISTERED AT `preview`. Thirteen routes, thirteen sources, no requirements.
-- Promotion happens after extraction or not at all.

insert into public.visa_countries (
  code, name, slug, immigration_authority, immigration_authority_url,
  foreign_affairs_authority, official_visa_url, official_languages,
  support_state, data_quality, jurisdiction_note, last_verified_at
) values (
  'JP', 'Japan', 'japan',
  'Immigration Services Agency (出入国在留管理庁)',
  'https://www.moj.go.jp/isa/',
  'Ministry of Foreign Affairs (外務省)',
  'https://www.moj.go.jp/isa/applications/status/index.html',
  array['ja'],
  'preview',
  'unverified',
  'Japan splits the decision in two. The Immigration Services Agency, an external '
  'bureau of the Ministry of Justice, defines and grants the residence STATUS — that is '
  'what these sources publish. The Ministry of Foreign Affairs issues the VISA through '
  'embassies and consulates, and www.mofa.go.jp returns HTTP 403 on robots.txt to our '
  'monitor, so it is not registered and is not read. A reader who needs the visa '
  'application procedure will not find it here. All sources are in Japanese; English '
  'labels in the requirements are VisaAI translations, not the authority''s wording.',
  '2026-08-24'::timestamptz
)
on conflict (code) do update set
  immigration_authority     = excluded.immigration_authority,
  immigration_authority_url = excluded.immigration_authority_url,
  foreign_affairs_authority = excluded.foreign_affairs_authority,
  official_visa_url         = excluded.official_visa_url,
  official_languages        = excluded.official_languages,
  support_state             = excluded.support_state,
  jurisdiction_note         = excluded.jurisdiction_note,
  last_verified_at          = excluded.last_verified_at;

-- official_name is each page's own H1, read on 2026-08-24, in Japanese. The
-- number prefix is the authority's own ordering of the 27 statuses.
insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
)
select
  (select id from public.visa_countries where code = 'JP'),
  v.visaai_id, v.category, v.official_name, v.slug, v.purpose,
  'active', 'unverified', '2026-08-24'::timestamptz
from (values
  ('jp-engineer-specialist-humanities-international-services', 'skilled_worker',
   '在留資格「技術・人文知識・国際業務」', 'engineer-specialist-humanities-international-services',
   'Status 12 of 27. The principal skilled-work status, covering engineering, humanities knowledge and international services.'),
  ('jp-highly-skilled-professional', 'skilled_worker',
   '在留資格「高度専門職」（高度人材ポイント制）', 'highly-skilled-professional',
   'Status 6 of 27. The points-based highly skilled professional status.'),
  ('jp-business-manager', 'entrepreneur',
   '在留資格「経営・管理」', 'business-manager',
   'Status 7 of 27. For running or managing a business in Japan.'),
  ('jp-researcher', 'research',
   '在留資格「研究」', 'researcher',
   'Status 10 of 27. For research on a contract with a public or private body in Japan.'),
  ('jp-intra-company-transferee', 'temporary_worker',
   '在留資格「企業内転勤」', 'intra-company-transferee',
   'Status 13 of 27. For transfer to a Japanese office of the same company or group.'),
  ('jp-student', 'student',
   '在留資格「留学」', 'student',
   'Status 21 of 27. For study at a Japanese educational institution.'),
  ('jp-spouse-or-child-of-permanent-resident', 'spouse_partner',
   '在留資格「永住者の配偶者等」', 'spouse-or-child-of-permanent-resident',
   'Status 27 of 27. For the spouse or child of a permanent resident.'),
  ('jp-instructor', 'work',
   '在留資格「教育」', 'instructor',
   'Status 11 of 27. For teaching at elementary, secondary and equivalent institutions.'),
  ('jp-dependent', 'dependant',
   '在留資格「家族滞在」', 'dependent',
   'Status 23 of 27. For the dependent spouse or child of a holder of another status.'),
  ('jp-specified-skilled-worker', 'skilled_worker',
   '在留資格「特定技能」', 'specified-skilled-worker',
   'Status 17 of 27. The Specified Skilled Worker status for designated industry fields.'),
  ('jp-nursing-care', 'work',
   '在留資格「介護」', 'nursing-care',
   'Status 14 of 27. For work as a certified care worker.'),
  ('jp-medical-services', 'work',
   '在留資格「医療」', 'medical-services',
   'Status 9 of 27. For medical work requiring a Japanese licence.'),
  ('jp-temporary-visitor', 'visitor',
   '在留資格「短期滞在」', 'temporary-visitor',
   'Status 20 of 27. Short-term stay for tourism, business visits, visiting relatives and similar.')
) as v(visaai_id, category, official_name, slug, purpose)
on conflict (visaai_id) do nothing;

insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language,
  robots_state, redistribution, check_interval, freshness_sla, active
)
select
  c.id, t.id, 'requirements',
  'Immigration Services Agency (出入国在留管理庁)', 1,
  u.url, u.url, v.title, 'ja',
  -- robots.txt is HTTP 200 on www.moj.go.jp with 1 disallow line and the path
  -- ALLOWED for our UA. Measured, not assumed.
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from (values
  ('jp-engineer-specialist-humanities-international-services', 'gijinkoku.html', '在留資格「技術・人文知識・国際業務」'),
  ('jp-highly-skilled-professional', 'designatedactivities02_00004.html', '在留資格「高度専門職」（高度人材ポイント制）'),
  ('jp-business-manager', 'businessmanager.html', '在留資格「経営・管理」'),
  ('jp-researcher', 'researcher.html', '在留資格「研究」'),
  ('jp-intra-company-transferee', 'intracompanytransfee.html', '在留資格「企業内転勤」'),
  ('jp-student', 'student.html', '在留資格「留学」'),
  ('jp-spouse-or-child-of-permanent-resident', 'spouseorchildofpermanentresident.html', '在留資格「永住者の配偶者等」'),
  ('jp-instructor', 'instructor.html', '在留資格「教育」'),
  ('jp-dependent', 'dependent.html', '在留資格「家族滞在」'),
  ('jp-specified-skilled-worker', 'specifiedskilledworker.html', '在留資格「特定技能」'),
  ('jp-nursing-care', 'nursingcare.html', '在留資格「介護」'),
  ('jp-medical-services', 'medicalservices.html', '在留資格「医療」'),
  ('jp-temporary-visitor', 'temporaryvisitor.html', '在留資格「短期滞在」')
) as v(visaai_id, leaf, title)
cross join lateral (select 'https://www.moj.go.jp/isa/applications/status/' || v.leaf as url) u
join public.visa_types t on t.visaai_id = v.visaai_id
join public.visa_countries c on c.id = t.country_id
on conflict do nothing;

do $$
declare n_types integer; n_src integer; n_state text; n_reqs integer; n_ja integer;
begin
  select count(*) into n_types from public.visa_types t
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'JP' and t.lifecycle_state = 'active';
  if n_types <> 13 then raise exception 'Expected 13 Japanese routes, found %', n_types; end if;

  select count(*) into n_src from public.visa_sources s
    join public.visa_countries c on c.id = s.country_id where c.code = 'JP';
  if n_src <> 13 then raise exception 'Expected 13 Japanese sources, found %', n_src; end if;

  -- Every source must be declared Japanese. A source silently marked 'en' would
  -- send the excerpt verifier and the display-excerpt derivation down the wrong
  -- path and would misdescribe the quotation to the reader.
  select count(*) into n_ja from public.visa_sources s
    join public.visa_countries c on c.id = s.country_id
   where c.code = 'JP' and s.language = 'ja';
  if n_ja <> 13 then raise exception 'All 13 Japanese sources must declare language ja; % do', n_ja; end if;

  -- MOFA refuses our monitor. Registering it would queue a source that can only
  -- fail, and a failure streak is not evidence once we already know the answer.
  if exists (select 1 from public.visa_sources s join public.visa_countries c on c.id = s.country_id
              where c.code = 'JP' and s.source_url like '%mofa.go.jp%') then
    raise exception 'www.mofa.go.jp returns 403 on robots.txt and must not be registered';
  end if;

  select support_state into n_state from public.visa_countries where code = 'JP';
  select count(*) into n_reqs from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id where c.code = 'JP';
  if n_state <> 'preview' or n_reqs <> 0 then
    raise exception 'Japan must register at preview with zero requirements; got % / %', n_state, n_reqs;
  end if;

  raise notice 'Japan registered: % routes, % sources, support_state=preview', n_types, n_src;
end $$;
