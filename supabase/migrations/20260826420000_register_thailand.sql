-- Thailand: admitted on the Department of Consular Affairs, and admitted on
-- its THAI pages rather than its English ones. The reason is the point.
--
-- WHAT STAYS BLOCKED
--
-- www.immigration.go.th publishes robots.txt with 9 disallow lines that ALLOW
-- the path we want, and then returns HTTP 403 on the page itself. Published
-- rules say yes, server says no; the refusal governs and the Immigration
-- Bureau is not registered. Same shape as Israel.
--
-- THE ENGLISH TREE EXISTS, IS READABLE, AND IS NOT USABLE
--
-- consular.mfa.go.th publishes a "Thai visa information" section in English at
-- cate-7393 / cate-7394 / cate-7395. It reads cleanly. Every page in it is
-- dated 2017-08-16 or 2017-09-07 — nine years old — and its catalogue lists
-- eight visa types that do not include the LTR visa, the SMART visa or the
-- e-Visa system, all of which Thailand now operates.
--
-- This is the GERMANY condition and the reason the probe gained a freshness
-- criterion. Reachable, well-structured, English, and superseded. Publishing
-- from it would launder a nine-year-old page as current, and it would do so on
-- the destination where the gap is most visible to a reader.
--
-- The Thai-language pages beside it were last updated 2022-11-30 and
-- 2024-05-24 and carry full requirements, fees and document lists. So the
-- language that reads worse is the language that is true, and Sweden already
-- set the precedent for taking it.
--
-- THE CATALOGUE AND THE REQUIREMENTS ARE ON DIFFERENT HOSTS
--
-- www.thaievisa.go.th is the official e-Visa system. Its own pages serve ZERO
-- characters — genuinely client-rendered — but its sitemap enumerates the
-- current route catalogue by name, all HTTP 200: tourist, transit,
-- business-investor, long-stay, ltr, smart, courtesy, diploma-official, and
-- non-immigrant ED/F/M/O/R/RS. That is how we know the 2017 English list is
-- incomplete rather than merely old.
--
-- thaievisa.go.th is NOT registered: it publishes no requirement text, and a
-- source that can only ever yield an empty fetch is not evidence of anything.
--
-- THREE ROUTES, NOT FIFTEEN, AND THE ARITHMETIC IS DELIBERATE
--
-- Of the pages the consular department publishes, exactly three carry
-- requirements: tourist, transit and non-immigrant. The long-stay (O-A/O-X)
-- page is a heading with no body. The SMART visa page is a heading, an
-- external link and two PDFs. Registering those as routes would publish two
-- pages whose entire content is their own title.
--
-- REGISTERED AT `preview`. Promotion happens after extraction or not at all.

insert into public.visa_countries (
  code, name, slug, immigration_authority, immigration_authority_url,
  foreign_affairs_authority, official_visa_url, official_languages,
  support_state, data_quality, jurisdiction_note, last_verified_at
) values (
  'TH', 'Thailand', 'thailand',
  'Immigration Bureau, Royal Thai Police (สำนักงานตรวจคนเข้าเมือง)',
  'https://consular.mfa.go.th/th/page/%E0%B8%9B%E0%B8%A3%E0%B8%B0%E0%B9%80%E0%B8%A0%E0%B8%97%E0%B9%81%E0%B8%A5%E0%B8%B0%E0%B8%AB%E0%B8%A5%E0%B8%B1%E0%B8%81%E0%B9%80%E0%B8%81%E0%B8%93%E0%B8%91%E0%B9%8C%E0%B8%81%E0%B8%B2%E0%B8%A3%E0%B8%82%E0%B8%AD-visa?menu=5ddcb8b29b1e8a30447d6f22',
  'Department of Consular Affairs, Ministry of Foreign Affairs (กรมการกงสุล)',
  'https://consular.mfa.go.th/th/page/%E0%B8%9B%E0%B8%A3%E0%B8%B0%E0%B9%80%E0%B8%A0%E0%B8%97%E0%B9%81%E0%B8%A5%E0%B8%B0%E0%B8%AB%E0%B8%A5%E0%B8%B1%E0%B8%81%E0%B9%80%E0%B8%81%E0%B8%93%E0%B8%91%E0%B9%8C%E0%B8%81%E0%B8%B2%E0%B8%A3%E0%B8%82%E0%B8%AD-visa?menu=5ddcb8b29b1e8a30447d6f22',
  array['th'],
  'preview',
  'unverified',
  'Thailand splits the decision. The Department of Consular Affairs (MFA) issues the VISA '
  'abroad and publishes these sources. The Immigration Bureau of the Royal Thai Police decides '
  'admission, length of stay in the Kingdom, extensions and changes of visa type — and '
  'www.immigration.go.th returns HTTP 403 to our monitor despite robots.txt permitting the '
  'path, so it is not registered. Every route here therefore states how to OBTAIN a visa and '
  'defers the stay itself to an authority we cannot read. All sources are Thai; English '
  'labels in the requirements are VisaAI translations. The department''s own English pages '
  'are dated 2017 and are deliberately not used.',
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

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
)
select
  (select id from public.visa_countries where code = 'TH'),
  v.visaai_id, v.category, v.official_name, v.slug, v.purpose,
  'active', 'unverified', '2026-08-24'::timestamptz
from (values
  ('th-tourist-visa', 'tourism',
   'นักท่องเที่ยว (Tourist Visa)', 'tourist-visa',
   'The tourist visa (TR) for travel to Thailand for tourism.'),
  ('th-transit-visa', 'other',
   'คนเดินทางผ่านราชอาณาจักร (Transit Visa)', 'transit-visa',
   'The transit visa, covering transit (TS), sports participation (S) and vehicle crew (C).'),
  ('th-non-immigrant-visa', 'other',
   'คนอยู่ชั่วคราว (Non-Immigrant Visa)', 'non-immigrant-visa',
   'The non-immigrant visa, one visa type covering ten lettered purposes including work (B), study (ED), media (M), religion (R), research (RS) and other (O).')
) as v(visaai_id, category, official_name, slug, purpose)
on conflict (visaai_id) do nothing;

insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language,
  robots_state, redistribution, check_interval, freshness_sla, active
)
select
  c.id, t.id, 'requirements',
  'Department of Consular Affairs, Ministry of Foreign Affairs (กรมการกงสุล)', 1,
  v.url, v.url, v.title, 'th',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from (values
  ('th-tourist-visa',
   'https://consular.mfa.go.th/th/publicservice/%e0%b8%99%e0%b8%b1%e0%b8%81%e0%b8%97%e0%b9%88%e0%b8%ad%e0%b8%87%e0%b9%80%e0%b8%97%e0%b8%b5%e0%b9%88%e0%b8%a2%e0%b8%a7-tourist-visa?page=5ddcb94a01330918812bbf22&menu=5ddcb8b29b1e8a30447d6f22',
   'นักท่องเที่ยว (Tourist Visa)'),
  ('th-transit-visa',
   'https://consular.mfa.go.th/th/publicservice/%e0%b8%84%e0%b8%99%e0%b9%80%e0%b8%94%e0%b8%b4%e0%b8%99%e0%b8%97%e0%b8%b2%e0%b8%87%e0%b8%9c%e0%b9%88%e0%b8%b2%e0%b8%99%e0%b8%a3%e0%b8%b2%e0%b8%8a%e0%b8%ad%e0%b8%b2%e0%b8%93%e0%b8%b2%e0%b8%88%e0%b8%b1%e0%b8%81%e0%b8%a3-transit-visa?page=5ddcb94a01330918812bbf22&menu=5ddcb8b29b1e8a30447d6f22',
   'คนเดินทางผ่านราชอาณาจักร (Transit Visa)'),
  ('th-non-immigrant-visa',
   'https://consular.mfa.go.th/th/publicservice/%e0%b8%84%e0%b8%99%e0%b8%ad%e0%b8%a2%e0%b8%b9%e0%b9%88%e0%b8%8a%e0%b8%b1%e0%b9%88%e0%b8%a7%e0%b8%84%e0%b8%a3%e0%b8%b2%e0%b8%a7-%e0%b9%8cnon-immigrant-visa?page=5ddcb94a01330918812bbf22&menu=5ddcb8b29b1e8a30447d6f22',
   'คนอยู่ชั่วคราว (Non-Immigrant Visa)')
) as v(visaai_id, url, title)
join public.visa_types t on t.visaai_id = v.visaai_id
join public.visa_countries c on c.id = t.country_id
on conflict do nothing;

do $$
declare n_types integer; n_src integer; n_state text; n_reqs integer;
begin
  select count(*) into n_types from public.visa_types t
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'TH' and t.lifecycle_state = 'active';
  if n_types <> 3 then raise exception 'Expected 3 Thai routes, found %', n_types; end if;

  select count(*) into n_src from public.visa_sources s
    join public.visa_countries c on c.id = s.country_id where c.code = 'TH';
  if n_src <> 3 then raise exception 'Expected 3 Thai sources, found %', n_src; end if;

  -- immigration.go.th refuses the page despite permitting the path.
  if exists (select 1 from public.visa_sources s join public.visa_countries c on c.id = s.country_id
              where c.code = 'TH' and s.source_url like '%immigration.go.th%') then
    raise exception 'immigration.go.th returns 403 on the page and must not be registered';
  end if;

  -- The 2017 English tree must never be registered: readable, superseded, and
  -- missing whole visa types Thailand now operates.
  if exists (select 1 from public.visa_sources s join public.visa_countries c on c.id = s.country_id
              where c.code = 'TH' and (s.source_url like '%cate-7393%' or s.source_url like '%cate-7394%'
                                       or s.source_url like '%cate-7395%')) then
    raise exception 'The 2017 English visa pages are superseded and must not be registered';
  end if;

  -- thaievisa.go.th serves zero characters; it names the catalogue and cannot
  -- evidence a requirement.
  if exists (select 1 from public.visa_sources s join public.visa_countries c on c.id = s.country_id
              where c.code = 'TH' and s.source_url like '%thaievisa.go.th%') then
    raise exception 'thaievisa.go.th serves no text and must not be registered as a requirements source';
  end if;

  select support_state into n_state from public.visa_countries where code = 'TH';
  select count(*) into n_reqs from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id where c.code = 'TH';
  if n_state <> 'preview' or n_reqs <> 0 then
    raise exception 'Thailand must register at preview with zero requirements; got % / %', n_state, n_reqs;
  end if;

  raise notice 'Thailand registered: % routes, % sources, support_state=preview', n_types, n_src;
end $$;
