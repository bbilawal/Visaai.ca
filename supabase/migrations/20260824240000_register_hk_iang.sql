-- Register Hong Kong's Immigration Arrangements for Non-local Graduates (IANG).
--
-- SIX MONTHS FROM GRADUATION DECIDES WHETHER YOU NEED A JOB
--
-- The whole route turns on one date, and it is not the date anyone watches:
--
--   * Apply within six months of the date on your graduation certificate ->
--     "not required to have secured an offer of employment upon application",
--     and 24 months' stay with no employment condition.
--   * Apply beyond six months -> "required to secure an offer of employment
--     upon application", and the job must be "at a level commonly taken up by
--     degree holders" with a "remuneration package ... at market level".
--
-- Same person, same degree, same 24 months if granted. A day's difference in
-- when the form is filed changes the requirement from nothing to a graduate-
-- level job offer. That is a deadline whose consequence is invisible until it
-- has passed, which is the second one this registry has found -- Ireland's
-- pre-marriage LTVP assessment being the first.
--
-- A 2x2, NOT A LIST
--
-- The Department runs the same recent/non-recent split across TWO populations:
--
--                        | recent (<= 6 months) | non-recent (> 6 months)
--   non-local graduate   | no offer needed      | offer needed
--   GBA campus graduate  | no offer needed      | offer needed
--
-- Both halves are registered. GBA campus graduates -- people who took a
-- full-time programme at a mainland Greater Bay Area campus jointly established
-- by mainland and Hong Kong universities -- are a distinct population with the
-- same rule, and folding them into one row would hide who the route is open to.
--
-- AND YOU CAN APPLY BEFORE YOU HAVE THE CERTIFICATE
--
-- "non-local recent graduates who have not yet obtained their graduation
-- certificate could apply to stay and work by producing proof from the
-- institution confirming that they have graduated." A route that lets the
-- six-month clock be beaten with a letter, which only helps somebody who knows
-- the clock exists.
--
-- BOUNDED, LIKE THE OTHER TWO HONG KONG ROUTES
--
-- One URL, entry plus extension of stay, each with its own criteria, documents,
-- processing time and fees.

insert into public.visa_types (
  country_id, visaai_id, category, official_name, official_code, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'HK'),
  'hk-non-local-graduates', 'work',
  'Immigration Arrangements for Non-local Graduates (IANG)', 'IANG',
  'immigration-arrangements-for-non-local-graduates',
  'Stay, return or come to work in Hong Kong after graduating from a Hong Kong institution or a Greater Bay Area campus jointly established with one.',
  'active', 'unverified', '2026-08-24'::timestamptz
)
on conflict (visaai_id) do update set
  official_name = excluded.official_name,
  official_code = excluded.official_code,
  purpose = excluded.purpose,
  last_verified_at = excluded.last_verified_at;

insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language,
  robots_state, redistribution, check_interval, freshness_sla, active
)
select
  c.id, t.id, v.role,
  'Immigration Department of the Hong Kong Special Administrative Region', 1,
  v.url, v.url, v.title, 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from (values
  ('requirements',
   'https://www.immd.gov.hk/eng/services/visas/IANG.html',
   'Immigration Arrangements for Non-local Graduates (IANG)')
) as v(role, url, title)
join public.visa_types t on t.visaai_id = 'hk-non-local-graduates'
join public.visa_countries c on c.id = t.country_id and c.code = 'HK'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'hk-non-local-graduates' and s.active;
  if n <> 1 then raise exception 'Expected 1 active ImmD source, found %.', n; end if;
end $$;
