-- Add Ireland's long term study visa — the page four rounds of URL guessing missed.
--
-- I deferred this twice, saying it needed the site read properly rather than
-- probed. Reading it took one request: `page-sitemap.xml` lists all 208 ISD
-- pages, and the study visa sits at
-- /coming-to-study-in-ireland/what-are-my-study-visa-options/how-to-apply-for-long-term-study-visa/
-- — a path no amount of pattern-guessing from the short-stay 'C' URL would
-- reach, because it is nested two levels deeper under a different section.
--
-- The guesses that failed were /how-to-apply-for-a-long-stay-d-visa/,
-- /how-to-apply-for-a-long-stay-d-study-visa/ and two more. The sitemap is
-- authoritative and costs one fetch. Use it first.
--
-- 19,734 characters of real requirements, against the 2-6k routers that made me
-- write Ireland off as fragmented. The site is fragmented; I was looking in the
-- wrong part of it.
--
-- ROBOTS
--
-- Unchanged from the short-stay registration: one `User-agent: *` group with a
-- single Disallow, which this path is not under.

insert into public.visa_types (
  country_id, visaai_id, category, official_name, official_code, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'IE'),
  'ie-long-term-study-visa', 'student',
  'Long Term Study Visa (D)', 'D', 'long-term-study-visa',
  'Study in Ireland for more than 3 months on a course approved under the '
    'policy for non-EEA nationals studying in Ireland.',
  'active', 'unverified', '2026-08-22'::timestamptz
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
  c.id, t.id, 'requirements', 'Immigration Service Delivery', 1,
  'https://www.irishimmigration.ie/coming-to-study-in-ireland/what-are-my-study-visa-options/how-to-apply-for-long-term-study-visa/',
  'https://www.irishimmigration.ie/coming-to-study-in-ireland/what-are-my-study-visa-options/how-to-apply-for-long-term-study-visa/',
  'How to apply for long term study visa', 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from public.visa_types t
join public.visa_countries c on c.id = t.country_id and c.code = 'IE'
where t.visaai_id = 'ie-long-term-study-visa'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'ie-long-term-study-visa';
  if n < 1 then raise exception 'Long term study visa source not registered.'; end if;
end $$;
