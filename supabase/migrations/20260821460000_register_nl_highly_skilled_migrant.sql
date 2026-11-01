-- Add a second Netherlands visa type: the highly skilled migrant permit.
--
-- Continues the depth pass. IND's residence-permits section has a clean list of
-- real per-permit pages — this one was taken from that list rather than guessed,
-- and the highly skilled migrant route is the Netherlands' flagship work permit.
--
-- WHY NOT IRELAND'S STUDY ROUTE, WHICH WAS THE STATED NEXT STEP
--
-- I started there and stopped. ISD's site is fragmented: the short-stay 'C'
-- page is 28,150 characters, and almost everything else in the study section is
-- a router of 2-6k characters. Four candidate long-stay 'D' URLs 404'd, and the
-- sitemap's study paths are all thin. Ireland's remaining routes need the site
-- read properly rather than more probing, and grinding guesses is the
-- anti-pattern recorded against the AEWV.
--
-- IND's structure is already proven — the student permit came from the same
-- list — so the same effort buys a real page here instead of a maybe there.

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'NL'),
  'nl-highly-skilled-migrant', 'work',
  'Residence permit highly skilled migrant', 'highly-skilled-migrant',
  'Work in the Netherlands as a highly skilled migrant, on an employment '
    'contract with an employer recognised as a sponsor by the IND.',
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
  c.id, t.id, 'requirements', 'Immigratie- en Naturalisatiedienst (IND)', 1,
  'https://ind.nl/en/residence-permits/work/highly-skilled-migrant',
  'https://ind.nl/en/residence-permits/work/highly-skilled-migrant',
  'Residence permit highly skilled migrant', 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from public.visa_types t
join public.visa_countries c on c.id = t.country_id and c.code = 'NL'
where t.visaai_id = 'nl-highly-skilled-migrant'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'nl-highly-skilled-migrant';
  if n < 1 then raise exception 'HSM source not registered.'; end if;
end $$;
