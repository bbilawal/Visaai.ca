-- Register Malaysia, and its Student Pass.
--
-- Malaysia is the registry's TWELFTH destination, its second in Asia, and the
-- one that forced a new check into `probe-authority.ts` before a single
-- requirement was extracted.
--
-- IT PASSED EVERY CHECK AND ONE OF ITS PAGES WAS A MENU
--
-- `www.imi.gov.my` returns 227KB of HTML per page, normalizing to ~11,000
-- characters, hitting all five requirement markers and mentioning the current
-- year. Every page. The Employment Pass page has THREE unique lines of content
-- inside an 820-line shared navigation menu -- the markers are menu labels and
-- the character count is the menu.
--
-- Character count and marker matching are properties of ONE page, and
-- boilerplate is by definition what pages SHARE, so neither could ever see it.
-- The probe now diffs pages from the same host against each other:
--
--   employment-pass                3/173 unique (2%)   <- rejected as a source
--   student-pass                  96/267 (36%)
--   residence-pass                98/269 (36%)
--   long-term-social-visit-pass  229/400 (57%)
--   professional-visitor-pass     73/244 (30%)
--
-- Malaysia is admitted on the pages that carry content. `my-employment-pass` is
-- deliberately NOT registered: the Immigration Department devolves expatriate
-- approval to the Expatriate Committee and the sector regulators, and its own
-- page says only that the pass issues to people those bodies have already
-- approved.
--
-- READABLE FROM PRODUCTION, CHECKED THE HARD WAY
--
-- All source URLs were re-fetched from the VPS before registration. The first
-- reading looked alarming -- 45KB from the VPS against 244KB locally, which is
-- the exact shape of the Finland failure -- and was wrong: `curl` was reporting
-- the gzip wire size. Decompressed, the VPS reads 244,685 bytes against 244,594
-- locally. Recorded because "the numbers differ" is not the same finding as
-- "the content differs", and one of those is a stop.
--
-- TWO AUTHORITIES DECIDE BEFORE IMMIGRATION DOES
--
-- Malaysia's student route runs through EMGS (Education Malaysia Global
-- Services) for academic screening and MOHA authorisation for the institution,
-- BEFORE the Immigration Department endorses anything. The applicant must be
-- OUTSIDE Malaysia when they apply, and must pass a post-arrival medical within
-- 7 days of landing. That ordering is the requirement -- getting it wrong is
-- not a delay, it is a refusal.
--
-- CURRENCY
--
-- MYR. Fees are published as "rm60.00" and "rm90.00"; the visa fee itself
-- "varies by country" and is not reproduced here.

insert into public.visa_countries (
  code, name, slug, immigration_authority, immigration_authority_url,
  foreign_affairs_authority, foreign_affairs_authority_url,
  official_visa_url, evisa_portal_url,
  official_languages, fee_currency, support_state,
  data_quality, last_verified_at, jurisdiction_note
) values (
  'MY', 'Malaysia', 'malaysia',
  'Jabatan Imigresen Malaysia (Immigration Department of Malaysia)',
  'https://www.imi.gov.my/',
  'Kementerian Luar Negeri Malaysia (Ministry of Foreign Affairs)',
  'https://www.kln.gov.my/',
  'https://www.imi.gov.my/index.php/en/main-services/visa/',
  'https://malaysiavisa.imi.gov.my/evisa/evisa.jsp',
  '{ms,en}', 'MYR', 'supported', 'verified', '2026-08-24'::timestamptz,
  'Malaysia routes several passes through a sector body BEFORE the Immigration '
  'Department sees them: EMGS (Education Malaysia Global Services) screens '
  'students and the Ministry of Home Affairs authorises the institution; the '
  'Expatriate Committee and sector regulators approve expatriates. The '
  'Immigration Department endorses and issues. Sabah and Sarawak administer '
  'their own immigration under the Malaysia Agreement and add state-specific '
  'documents, which the Department states on the same pages. Only pages whose '
  'content is distinct from the site navigation are registered as sources -- '
  'imi.gov.my serves an identical 820-line menu on every page, and several of '
  'its pages are nothing else.'
)
on conflict (code) do update set
  immigration_authority = excluded.immigration_authority,
  foreign_affairs_authority = excluded.foreign_affairs_authority,
  support_state = excluded.support_state,
  jurisdiction_note = excluded.jurisdiction_note,
  last_verified_at = excluded.last_verified_at;

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'MY'),
  'my-student-pass', 'student',
  'Student Pass',
  'student-pass',
  'Study full-time in Malaysia at a public university, an approved private higher education institution, a language or skills centre, or a school.',
  'active', 'unverified', '2026-08-24'::timestamptz
)
on conflict (visaai_id) do update set
  official_name = excluded.official_name,
  purpose = excluded.purpose,
  last_verified_at = excluded.last_verified_at;

insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language,
  robots_state, redistribution, check_interval, freshness_sla, active
)
select
  c.id, t.id, v.role,
  'Jabatan Imigresen Malaysia (Immigration Department of Malaysia)', 1,
  v.url, v.url, v.title, 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from (values
  ('requirements',
   'https://www.imi.gov.my/index.php/en/main-services/pass/student-pass/',
   'Student Pass')
) as v(role, url, title)
join public.visa_types t on t.visaai_id = 'my-student-pass'
join public.visa_countries c on c.id = t.country_id and c.code = 'MY'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'my-student-pass' and s.active;
  if n <> 1 then raise exception 'Expected 1 active Immigration Department source, found %.', n; end if;
end $$;
