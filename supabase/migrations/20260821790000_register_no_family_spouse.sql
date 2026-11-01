-- Add Norway family immigration with a Norwegian/Nordic citizen, spouse route.
-- Norway now has 4 types, and the registry gains its first family-reunification
-- route across all 8 destinations.
--
-- WHAT MAKES THIS ONE UNUSUAL TO EXTRACT
--
-- 1. THE PAGE CONCATENATES EIGHT FAMILY CATEGORIES.
--    /family-immigration-with-norwegian-or-nordic-citizen/ is 21,998 characters
--    holding spouse, cohabitant, fiance(e), children, parents and more, each
--    with its own "requirements for both / applicant / reference person" block.
--    "how to apply" occurs 8+ times and the income figure repeats verbatim in
--    every block. An unbounded extraction would attribute one category's rules
--    to another -- the same trap that nearly gave Norway's skilled-worker permit
--    an athlete's salary threshold.
--
--    So extraction is BOUNDED to characters 3,709-5,557, the spouse block,
--    which ends where the "cohabitant" heading begins. Excerpt verification
--    proves a quote is ON the page; it cannot prove the quote is about the
--    right family member. Only the bound does that.
--
-- 2. THE OBLIGATION IS SPLIT ACROSS TWO PEOPLE.
--    Every other visa type in the registry states requirements for one person.
--    Here UDI separates "requirements for the applicant" from "requirements for
--    the reference person" -- and the income requirement falls entirely on the
--    sponsor in Norway, who is not the applicant. A checklist that hands the
--    applicant "you must earn NOK 436,957" would be simply wrong about who owes
--    what, so each requirement records whose obligation it is.
--
-- 3. THE INCOME FIGURE IS EXPLICITLY DATED BY UDI ITSELF.
--    The page says the amount "is adjusted in may each year, but this is the
--    applicable amount if you apply now". That is the authority telling us its
--    own number expires. Recorded with the adjustment cadence rather than as a
--    standing fact.
--
-- WHY THE URL CARRIES NO ?c= PARAMETER
--
-- Norway's visitor visa needed ?c=ind because the bare URL returned a
-- 4,726-character stub. Here the bare URL returns the full 21,998 characters and
-- ?c=ind returns 22,260 -- a 262-character personalisation delta that touches no
-- requirement. Registering the bare URL keeps an arbitrary nationality out of
-- the source, so the daily monitor diffs the rules rather than the personalisation.
--
-- The family-immigration HUB is deliberately NOT registered. It is a multi-step
-- guide: ?c= (applicant) then &f= (reference person) then a yes/no on prior
-- EU/EEA residence, and it never states a requirement itself.

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'NO'),
  'no-family-spouse', 'family',
  'Family immigration with a Norwegian or Nordic citizen (spouse or registered partner)',
  'family-immigration-spouse',
  'Move to Norway to live with a spouse or registered partner who is a '
    'Norwegian or Nordic citizen.',
  'active', 'unverified', '2026-08-22'::timestamptz
)
on conflict (visaai_id) do update set
  official_name = excluded.official_name,
  purpose = excluded.purpose,
  last_verified_at = excluded.last_verified_at;

-- Three sources. The main page states the rules but LINKS the fee and the age
-- exemption rather than stating them, so those pages are registered separately
-- instead of having their content inferred.
insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language,
  robots_state, redistribution, check_interval, freshness_sla, active
)
select c.id, t.id, v.role, 'Utlendingsdirektoratet (UDI)', 1,
       v.url, v.url, v.title, 'en',
       'allowed', 'unknown', interval '1 day', interval '30 days', true
from public.visa_types t
join public.visa_countries c on c.id = t.country_id and c.code = 'NO'
cross join (values
  ('requirements',
   'https://www.udi.no/en/want-to-apply/family-immigration/family-immigration-with-norwegian-or-nordic-citizen/',
   'Family immigration with a Norwegian or Nordic citizen'),
  ('fees',
   'https://www.udi.no/en/word-definitions/fees/family-immigration/',
   'Fees - family immigration'),
  ('requirements',
   'https://www.udi.no/en/word-definitions/requirement-to-be-at-least-24-years-old-in-applications-for-family-immigration/',
   'Requirement to be at least 24 years old in applications for family immigration')
) as v(role, url, title)
where t.visaai_id = 'no-family-spouse'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'no-family-spouse';
  if n < 3 then raise exception 'Expected 3 sources for no-family-spouse, found %.', n; end if;
end $$;
