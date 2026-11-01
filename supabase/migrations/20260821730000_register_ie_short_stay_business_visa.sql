-- Add Ireland's Short Stay 'C' Business Visa. Ireland now has 3 visa types.
--
-- FOUND VIA THE SITEMAP, AND THE PATH MATTERS
--
-- I previously sized
-- /coming-to-work-in-ireland/what-are-my-options-for-working-in-ireland/applying-for-a-long-stay-employment-visa/
-- at 2,599 characters and concluded Ireland's work section was all routers.
-- The sitemap shows there are TWO similarly-named branches —
-- ".../what-are-my-options-for-working-in-ireland/..." and
-- ".../what-are-my-work-visa-options/..." — and the substantive pages sit under
-- the first, three levels deep.
--
-- The short stay business visa is 27,180 characters. The long stay employment
-- visa page really is a 2,793-character router, so that one still needs its own
-- pass.
--
-- WHY THIS VISA IS NOT A COPY OF THE SHORT STAY 'C' VISIT VISA
--
-- Both are 90-day 'C' visas and Ireland already has the visit one. The
-- difference is a rule with sharp edges: this visa permits WORK, but only if it
-- starts and ends inside a single 14-day period, and only once per 90 days.
-- ISD spells out two worked examples of arrangements that fail it — 7 days, a
-- 10-day gap, then 7 more; or 14 days, leave, return for 14 more. Both require
-- the atypical working scheme and a different visa instead.
--
-- That is exactly the kind of trap a business traveller plans straight into.

insert into public.visa_types (
  country_id, visaai_id, category, official_name, official_code, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'IE'),
  'ie-short-stay-business-visa', 'business',
  'Short Stay ''C'' Business Visa', 'C', 'short-stay-business-visa',
  'Travel to Ireland for up to 90 days for business — meetings, negotiating or '
    'signing agreements — or for work lasting 14 days or less.',
  'active', 'unverified', '2026-08-22'::timestamptz
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
  c.id, t.id, 'requirements', 'Immigration Service Delivery', 1,
  'https://www.irishimmigration.ie/coming-to-work-in-ireland/what-are-my-options-for-working-in-ireland/coming-to-work-for-less-than-90-days/short-stay-business-visa/',
  'https://www.irishimmigration.ie/coming-to-work-in-ireland/what-are-my-options-for-working-in-ireland/coming-to-work-for-less-than-90-days/short-stay-business-visa/',
  'Short Stay Business Visa', 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from public.visa_types t
join public.visa_countries c on c.id = t.country_id and c.code = 'IE'
where t.visaai_id = 'ie-short-stay-business-visa'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'ie-short-stay-business-visa';
  if n < 1 then raise exception 'Business visa source not registered.'; end if;
end $$;
