-- Register Malaysia's Residence Pass -- Malaysia's third route, and the first
-- anywhere in this registry where the SPONSOR'S STATE OF ORIGIN is a condition.
--
-- SABAH AND SARAWAK NEED A SABAHAN OR SARAWAKIAN SPONSOR
--
--   "applications in west malaysia must be sponsored by a malaysia citizen;
--    applications in sabah and sarawak must be sponsored by a malaysian citizen
--    of sabah or sarawak origin;"
--
-- Not a documentary variation -- a different sponsor. A Malaysian citizen from
-- Kuala Lumpur cannot sponsor a Residence Pass application made in Sabah. The
-- two states administer their own immigration under the Malaysia Agreement, and
-- this is the sharpest consequence of that the registry has found: the same
-- national citizenship qualifies or does not depending on where the applicant
-- is standing.
--
-- MARRYING A CITIZEN COSTS THREE YEARS; MARRYING A PERMANENT RESIDENT COSTS FIVE
--
--   Category 3 (family of a Malaysian CITIZEN): "resided in malaysia for at
--   least three (3) years on a valid long term pass"
--   Category 4 (family of a PERMANENT RESIDENT): "at least five (5) years"
--
-- Same relationship, same pass, two extra years because of the spouse's own
-- status. Both figures are on one page and neither is stated as a comparison,
-- which is exactly the kind of thing a checklist can show and a page cannot.
--
-- AND THE PASS DOES WHAT THREE SEPARATE PASSES DO ELSEWHERE
--
--   "residence pass holders are eligible to work, study, and setting up a
--    business without having to convert to another pass"
--
-- Malaysia's Long-Term Social Visit Pass already let a spouse work without
-- converting, by endorsement. This goes further -- work, study AND business, on
-- the pass itself. Singapore needs an employer-lodged work pass for the first,
-- a Student's Pass for the second and an EntrePass for the third.
--
-- BOTH PARTIES IN PERSON
--
-- "both sponsor and applicant must be present during submission of documents at
-- the immigration office." The sponsor cannot send documents; they must attend.
--
-- WHY THIS PAGE NEEDS NO BOUND
--
-- Unlike Hong Kong's tabbed pages, imi.gov.my publishes one subject here:
-- categories 3, 4 and 5 of Regulation 16A. Categories 1 and 2 -- the
-- Residence Pass-Talent route -- are not on this page and are not claimed.

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'MY'),
  'my-residence-pass', 'permanent_residence',
  'Residence Pass',
  'residence-pass',
  'Live in Malaysia long-term through family ties to a Malaysian citizen or permanent resident, or as a former Malaysian, with the right to work, study and run a business on the same pass.',
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
   'https://www.imi.gov.my/index.php/en/main-services/pass/residence-pass/',
   'Residence Pass')
) as v(role, url, title)
join public.visa_types t on t.visaai_id = 'my-residence-pass'
join public.visa_countries c on c.id = t.country_id and c.code = 'MY'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'my-residence-pass' and s.active;
  if n <> 1 then raise exception 'Expected 1 active Immigration Department source, found %.', n; end if;
end $$;
