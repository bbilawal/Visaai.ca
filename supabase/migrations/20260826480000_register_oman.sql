begin;

-- Oman: admitted on work permits, and NOT on entry visas. The asymmetry is the
-- finding, not a shortfall in the research.
--
-- WHAT STAYS UNREADABLE
--
-- evisa.rop.gov.om is the Royal Oman Police e-Visa portal and it is willing:
-- robots.txt is 404, which is conventionally unrestricted. It serves 44,892
-- bytes for its "Know your Visa Type" catalogue that normalise to 927
-- characters, because the catalogue is rendered by script. www.rop.gov.om
-- serves 374 bytes normalising to zero. Nobody has refused us; there is simply
-- no text. Oman's ENTRY VISAS therefore remain unpublished and this
-- destination does not pretend otherwise.
--
-- WHAT OPENED
--
-- www.mol.gov.om, the Ministry of Labour, answers with robots.txt 200 and a
-- 250-URL sitemap, and publishes work-permit e-services with real fee tables
-- and real conditions. Work permits are not visas: they authorise EMPLOYMENT,
-- and the entry visa remains a separate ROP matter we cannot read. France sets
-- the precedent for registering a work authorisation as its own route
-- (fr-autorisation-travail-salarie); this is the same shape.
--
-- SIX OF NINE CANDIDATES, AND THE THREE REJECTIONS ARE THE POINT
--
-- The Malaysia failure was a 227KB page normalising to 10,922 characters that
-- hit every requirement marker and contained THREE unique lines inside an
-- 820-line shared menu. So every candidate here was diffed against ALL the
-- others, not pairwise-in-order:
--
--   Commercial work permit (284)      19 of 102 lines unique  19%   REGISTERED
--   Private work permit (290)         24 of 102 unique        24%   REGISTERED
--   Heat work permit (348)            21 of  99 unique        21%   REGISTERED
--   Cancellation (285)                17 of  91 unique        19%   REGISTERED
--   Work permit transfer (286)        11 of  85 unique        13%   REGISTERED
--   Renewal, individuals (288)         6 of  82 unique         7%   REGISTERED
--   Renewal, establishments (282)      6 of  87 unique         7%   rejected
--   Issuance, establishments (283)     3 of  83 unique         4%   rejected
--   Issuance, individual (289)         3 of  78 unique         4%   rejected
--
-- The two 3-unique-line pages are the Malaysian condition exactly, and they are
-- not registered. 288 is registered at 6 unique lines because those six lines
-- carry the renewal FEE TABLE and a ministerial decision number — substance
-- rather than chrome — which is a judgement the ratio alone cannot make.
--
-- CASE-VARIANT URLS ARE THE SAME PAGE
--
-- The sitemap lists 250 URLs that collapse to 216 once case is normalised:
-- this host serves each service under /manpoweralleservices/details/,
-- /ManpowerAllEServices/Details/ and /ManpowerAllEservices/Details/, plus
-- bare-numeric slugs. Registering two spellings would make the change monitor
-- track one page twice and diff it against itself. The canonical form used
-- below is the one the ministry's own navigation links to.

insert into public.visa_countries (
  code, name, slug, immigration_authority, immigration_authority_url,
  official_visa_url, official_languages,
  support_state, data_quality, jurisdiction_note, last_verified_at
) values (
  'OM', 'Oman', 'oman',
  'Ministry of Labour (وزارة العمل)',
  'https://www.mol.gov.om/',
  'https://www.mol.gov.om/ManpowerAllEServices',
  array['ar'],
  'preview',
  'unverified',
  'THIS DESTINATION COVERS WORK PERMITS, NOT ENTRY VISAS. The Ministry of Labour authorises '
  'the EMPLOYMENT of non-Omani workers and publishes these sources. Entry and residence are '
  'decided by the Royal Oman Police, whose e-Visa portal serves its visa catalogue as '
  'client-rendered script — 44,892 bytes normalising to 927 characters — so no entry-visa '
  'requirement can be read. Nobody has refused us; there is no text. A worker needs BOTH a '
  'Ministry of Labour work permit and an ROP visa, and only the first is published here. '
  'Sources are Arabic; English labels in the requirements are VisaAI translations.',
  '2026-08-24'::timestamptz
)
on conflict (code) do update set
  immigration_authority     = excluded.immigration_authority,
  immigration_authority_url = excluded.immigration_authority_url,
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
  (select id from public.visa_countries where code = 'OM'),
  v.visaai_id, v.category, v.official_name, v.slug, v.purpose,
  'active', 'unverified', '2026-08-24'::timestamptz
from (values
  ('om-commercial-work-permit', 'work',
   'إصدار تصاريح مزاولة العمل التجاري (المنشآت)', 'commercial-work-permit',
   'Commercial work permits for non-Omani workers and investors, applied for by an establishment.'),
  ('om-private-work-permit', 'work',
   'إصدار تصاريح مزاولة العمل الخاصة (الأفراد)', 'private-work-permit',
   'Private work permits for domestic workers and equivalent occupations, applied for by an individual employer.'),
  ('om-work-permit-renewal', 'work',
   'تجديد بيانات القوى العاملة غير العُمانية (الأفراد)', 'work-permit-renewal',
   'Renewal of an expired or expiring work permit for a non-Omani worker, by an individual employer.'),
  ('om-work-permit-transfer', 'work',
   'نقل خدمات القوى العاملة غير العمانية (الأفراد)', 'work-permit-transfer',
   'Transfer of a non-Omani worker''s services to another employer.'),
  ('om-work-permit-cancellation', 'other',
   'إلغاء تصريح مزاولة العمل (الأفراد)', 'work-permit-cancellation',
   'Cancellation of a work permit, whether at end of service or for another reason including a change of visa type.'),
  ('om-heat-work-permit', 'other',
   'تصاريح العمل في أوقات الظهيرة لأشهر الصيف', 'heat-work-permit',
   'Permit to work during the prohibited midday hours in the summer months, subject to occupational safety conditions.')
) as v(visaai_id, category, official_name, slug, purpose)
on conflict (visaai_id) do nothing;

insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language,
  robots_state, redistribution, check_interval, freshness_sla, active
)
select
  c.id, t.id, 'requirements',
  'Ministry of Labour (وزارة العمل)', 1,
  v.url, v.url, v.title, 'ar',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from (values
  ('om-commercial-work-permit', 'https://www.mol.gov.om/ManpowerAllEServices/Details/Commercial-Work-Permit-establishments-284', 'إصدار تصاريح مزاولة العمل التجاري'),
  ('om-private-work-permit', 'https://www.mol.gov.om/ManpowerAllEServices/Details/Private-Work-Permit-individuals-290', 'إصدار تصاريح مزاولة العمل الخاصة'),
  ('om-work-permit-renewal', 'https://www.mol.gov.om/ManpowerAllEServices/Details/Work-Permit-Renewal-individuals-288', 'تجديد بيانات القوى العاملة غير العُمانية'),
  ('om-work-permit-transfer', 'https://www.mol.gov.om/ManpowerAllEServices/Details/Work-Permit-Transfer-individuals-286', 'نقل خدمات القوى العاملة غير العمانية'),
  ('om-work-permit-cancellation', 'https://www.mol.gov.om/ManpowerAllEServices/Details/Cancellation-of-Work-Permit-individuals-285', 'إلغاء تصريح مزاولة العمل'),
  ('om-heat-work-permit', 'https://www.mol.gov.om/ManpowerAllEServices/Details/Heat-WorkPermit-Application-348', 'تصاريح العمل في أوقات الظهيرة')
) as v(visaai_id, url, title)
join public.visa_types t on t.visaai_id = v.visaai_id
join public.visa_countries c on c.id = t.country_id
on conflict do nothing;

do $$
declare n_types integer; n_src integer; n_state text; n_reqs integer; n_dupcase integer;
begin
  select count(*) into n_types from public.visa_types t
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'OM' and t.lifecycle_state = 'active';
  if n_types <> 6 then raise exception 'Expected 6 Omani routes, found %', n_types; end if;

  select count(*) into n_src from public.visa_sources s
    join public.visa_countries c on c.id = s.country_id where c.code = 'OM';
  if n_src <> 6 then raise exception 'Expected 6 Omani sources, found %', n_src; end if;

  -- CASE-VARIANT URLS ARE THE SAME PAGE. Two spellings would make the monitor
  -- track one page twice and diff it against itself.
  select count(*) into n_dupcase from (
    select lower(s.source_url) lu, count(*) c
      from public.visa_sources s join public.visa_countries co on co.id = s.country_id
     where co.code = 'OM' group by 1 having count(*) > 1) d;
  if n_dupcase <> 0 then
    raise exception '% Omani source URL(s) differ only by case — canonicalise before registering', n_dupcase;
  end if;

  -- The ROP e-Visa portal serves no text and must not be registered as a
  -- requirements source: a source that can only yield an empty fetch is not
  -- evidence of anything.
  if exists (select 1 from public.visa_sources s join public.visa_countries c on c.id = s.country_id
              where c.code = 'OM' and s.source_url like '%rop.gov.om%') then
    raise exception 'The ROP e-Visa portal is client-rendered and must not be registered';
  end if;

  select support_state into n_state from public.visa_countries where code = 'OM';
  select count(*) into n_reqs from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id where c.code = 'OM';
  if n_state <> 'preview' or n_reqs <> 0 then
    raise exception 'Oman must register at preview with zero requirements; got % / %', n_state, n_reqs;
  end if;

  raise notice 'Oman registered: % routes, % sources, support_state=preview', n_types, n_src;
end $$;

commit;
