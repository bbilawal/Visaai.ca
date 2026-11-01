-- Add Norway family immigration for a COHABITANT. Norway reaches 5 types; the
-- registry reaches 38 across 8 destinations.
--
-- THE SAME URL AS THE SPOUSE ROUTE, AND THE REASON source_bounds EXISTS
--
-- UDI's family page is 21,998 characters carrying 8+ family routes, each with
-- its own "requirements for both / applicant / reference person" block and the
-- same income figure repeated verbatim. no-family-spouse.json reads characters
-- 3709-5557; this reads 5557-7233.
--
-- Both files now pass verify-extraction-bounds.ts against their own block, and
-- the tool reports what it is protecting: 4 of this route's 9 page-sourced
-- excerpts ALSO appear verbatim outside its bound, and 5 of the spouse route's
-- 9 do. Point this file at the spouse bound and 5 requirements fail, including
-- both cohabitation alternatives, which exist only here. Excerpt verification
-- alone passes every one of those from the wrong block.
--
-- The bound anchors on "both of you must be over the age of 18." rather than on
-- the word "cohabitant", which occurs 8 times on the page. The checker rejects a
-- non-unique start anchor, which is what forced the better one.
--
-- THE ROUTES GENUINELY DIFFER -- THIS IS NOT A NEAR-DUPLICATE
--
--   * An 18-year floor that the spouse route does not state, ON TOP of the
--     24-year rule. Both are in UDI's own list; the redundancy is theirs.
--   * The core test is ALTERNATIVES -- two years living together, OR a child
--     together -- where the spouse route lists conditions that must all hold.
--     UDI writes "one of the following two requirements".
--   * The application fee sits under "requirements for the applicant" here and
--     under "requirements for both" in the spouse block.
--   * No marriage-validity, marriage-recognition, forced-marriage or
--     circumvention-marriage conditions at all.
--
-- An unbounded extraction would have blurred every one of those differences,
-- and would have looked perfectly well-sourced doing it.

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'NO'),
  'no-family-cohabitant', 'family',
  'Family immigration with a Norwegian or Nordic citizen (cohabitant)',
  'family-immigration-cohabitant',
  'Move to Norway to live with an unmarried partner who is a Norwegian or '
    'Nordic citizen.',
  'active', 'unverified', '2026-08-22'::timestamptz
)
on conflict (visaai_id) do update set
  official_name = excluded.official_name,
  purpose = excluded.purpose,
  last_verified_at = excluded.last_verified_at;

-- The same three UDI pages the spouse route uses. Since 20260820160000 a shared
-- government page carries one visa_sources row PER VISA TYPE, so these are new
-- rows rather than a second visa type borrowing the spouse's — which is what
-- lets the requirements migration resolve one unambiguous active version.
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
  ('eligibility',
   'https://www.udi.no/en/word-definitions/requirement-to-be-at-least-24-years-old-in-applications-for-family-immigration/',
   'Requirement to be at least 24 years old in applications for family immigration')
) as v(role, url, title)
where t.visaai_id = 'no-family-cohabitant'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'no-family-cohabitant';
  if n < 3 then raise exception 'Expected 3 sources for no-family-cohabitant, found %.', n; end if;
end $$;
