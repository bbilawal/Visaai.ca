-- Add the Netherlands residence permit for a partner. NL reaches 5 types; the
-- registry reaches 37 across 8 destinations, and its fourth family route.
--
-- THE PAGE RENDERS ITS REQUIREMENT LIST TWICE, AND THE COPIES DIFFER
--
-- Two blocks both open "1. check requirements": A at chars 4145-8130 and B at
-- 8130-11023. A line-by-line diff finds 10 lines present only in A and ZERO
-- present only in B -- B is a strict subset. The A-only content is the
-- tuberculosis test and the civic integration exam abroad.
--
-- No control selects between them. Every input, select, option and button on the
-- page was read (the lesson from UDI's hidden input) and none splits content, so
-- the distinction had to come from IND's own wording rather than inference.
-- Step 3 supplies it: variant A says "you apply for the mvv and the residence
-- permit at the same time" and offers a Dutch embassy abroad; variant B says
-- only "you can apply online or in writing by post".
--
-- So A is the MVV route -- the partner is abroad -- and B is the route with no
-- MVV. That makes the two A-only requirements coherent rather than arbitrary:
-- the civic integration exam is due "before you apply for the mvv", and the TB
-- test "after your partner arrives in the netherlands". Confirmed by counting
-- occurrences: those two plus the MVV application step appear exactly once on
-- the page, and all thirteen other excerpts appear twice.
--
-- This registers the MVV route, the superset and the case most applicants are
-- in. No source_bounds is declared, because B holds nothing A lacks -- there is
-- no sibling text to be mis-attributed. Contrast the Norway spouse permit, where
-- one url carries 8+ different family routes and a bound is load-bearing.
--
-- NO INCOME FIGURE IS RECORDED, DELIBERATELY
--
-- IND states the income requirement and links an income test rather than
-- publishing an amount on this page. A number recalled or inferred for that
-- field would be the most damaging error available here, so the requirement is
-- stored with its own wording and no parameters.

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'NL'),
  'nl-partner-residence-permit', 'family',
  'Residence permit for partner', 'partner-residence-permit',
  'Bring a foreign partner to live with you in the Netherlands, applying for '
    'the MVV and the residence permit together.',
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
select c.id, t.id, 'requirements', 'Immigratie- en Naturalisatiedienst (IND)', 1,
  'https://ind.nl/en/residence-permits/family-and-partner/residence-permit-for-partner',
  'https://ind.nl/en/residence-permits/family-and-partner/residence-permit-for-partner',
  'Residence permit for partner', 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from public.visa_types t
join public.visa_countries c on c.id = t.country_id and c.code = 'NL'
where t.visaai_id = 'nl-partner-residence-permit'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'nl-partner-residence-permit';
  if n < 1 then raise exception 'Partner permit source not registered.'; end if;
end $$;
