-- Add Norway's study permit. Norway now has 2 visa types.
--
-- THE PARAMETER LESSON DID NOT TRANSFER, WHICH IS WHY IT WAS CHECKED
--
-- The Norwegian VISITOR visa needed `?c=<nationality>`: its bare URL returns
-- 4,726 characters with none of the requirements. I assumed the same would hold
-- here and measured instead:
--
--   /studies/studietillatelse/          -> 20,582 characters
--   /studies/studietillatelse/?c=ind    -> 19,765 characters
--
-- The bare URL is LARGER. The study permit serves its requirements without a
-- nationality, and the parameter only trims surrounding guidance — the opposite
-- of the visitor page. So the clean URL is registered, with no arbitrary
-- nationality baked into a source for a page that does not need one.
--
-- Carrying a pattern across two pages of the same site would have been wrong in
-- both directions: a `?c=ind` URL here, or a bare URL on the visitor visa.

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'NO'),
  'no-study-permit', 'student', 'Study permit', 'study-permit',
  'Study or attend school in Norway for more than three months, with the right '
    'to work up to 20 hours a week during term and full-time in holidays.',
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
  c.id, t.id, 'requirements', 'Utlendingsdirektoratet (UDI)', 1,
  'https://www.udi.no/en/want-to-apply/studies/studietillatelse/',
  'https://www.udi.no/en/want-to-apply/studies/studietillatelse/',
  'Study permit', 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from public.visa_types t
join public.visa_countries c on c.id = t.country_id and c.code = 'NO'
where t.visaai_id = 'no-study-permit'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'no-study-permit';
  if n < 1 then raise exception 'Study permit source not registered.'; end if;
end $$;
