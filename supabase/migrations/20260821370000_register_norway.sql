-- Register Norway and the visitor visa. CORRECTS A WRONG CONCLUSION OF MINE.
--
-- I recorded Norway as "BLOCKED — JS-only" hours ago, having found that
-- /en/want-to-apply/visit-and-holiday/ is a nationality selector whose visible
-- <select> is `display:none` with no `name`, and concluded there was no query
-- parameter to construct.
--
-- That was wrong, and wrong in an avoidable way: I inspected the <select> and
-- stopped. The same form contains
--
--   <input type="hidden" name="c" id="selected-value" />
--
-- which is what actually carries the value. `?c=ind` returns a personalised
-- page, and the visitor visa detail page behind it —
-- /visit-and-holiday/visitors-visa-to-norway/ — is 29,971 characters of plain
-- server-rendered requirements: passport validity, travel insurance, per-day
-- funds thresholds in NOK, fingerprints, sponsorship.
--
-- No JavaScript execution is needed and none was added. The lesson is narrower
-- and more useful than "the site is a SPA": when a form looks unusable, read
-- ALL of its controls, not the one the user interacts with.
--
-- ROBOTS
--
-- www.udi.no/robots.txt fetched and read: a single `User-agent: *` group with
-- ZERO Disallow entries — the most permissive of any authority in the registry.
--
-- THE QUERY PARAMETER IS REQUIRED, AND THAT WAS ALSO CHECKED
--
-- My first instinct was to register the bare URL and treat `?c=` as cosmetic.
-- Measured instead of assumed, and it is not cosmetic:
--
--   /visitors-visa-to-norway/            ->  4,726 characters, NO requirements
--   /visitors-visa-to-norway/?c=ind      -> 29,971 characters, all of them
--
-- The bare page contains none of "valid travel insurance", "nok 300 per day",
-- "passport that is valid for at least three months" or "register your
-- fingerprints". Registering it would have given the monitor a page to diff and
-- an extractor nothing to quote — the same mistake avoided on INZ's router
-- page, one layer deeper.
--
-- So a parameterised URL is registered. `?c=ind` is one nationality's variant,
-- which raises the obvious question: do the requirements differ by nationality?
-- Fetched and compared three (`ind`, `chn`, `usa`, spanning visa-required and
-- visa-free): all four probe strings above are present in all three, and the
-- length differences are in the surrounding guidance, not the requirement text.
--
-- The extraction therefore quotes requirements that are invariant across the
-- nationalities checked. If UDI ever varies them, the daily diff on this URL
-- will show it for `ind` — which is a real limitation, recorded here rather
-- than papered over.

insert into public.visa_countries (
  code, name, slug, immigration_authority, immigration_authority_url,
  official_visa_url, official_languages, fee_currency, support_state,
  data_quality, last_verified_at
) values (
  'NO', 'Norway', 'norway',
  'Utlendingsdirektoratet (UDI)',
  'https://www.udi.no/en/',
  'https://www.udi.no/en/want-to-apply/visit-and-holiday/',
  '{no,en}', 'NOK', 'supported', 'verified', '2026-08-22'::timestamptz
)
on conflict (code) do update set
  immigration_authority = excluded.immigration_authority,
  support_state = excluded.support_state,
  last_verified_at = excluded.last_verified_at;

insert into public.visa_types (
  country_id, visaai_id, category, official_name, slug,
  purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = 'NO'),
  'no-visitor-visa', 'visitor', 'Visitor''s visa', 'visitors-visa',
  'Visit Norway for up to 90 days. The visa is valid in all Schengen countries.',
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
  c.id, t.id, v.role, 'Utlendingsdirektoratet (UDI)', 1,
  v.url, v.url, v.title, 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from (values
  ('requirements',
   'https://www.udi.no/en/want-to-apply/visit-and-holiday/visitors-visa-to-norway/?c=ind',
   'Visitor''s visa to Norway (nationality-parameterised; requirements verified invariant across ind/chn/usa)'),
  ('landing',
   'https://www.udi.no/en/want-to-apply/visit-and-holiday/',
   'Visits and holidays')
) as v(role, url, title)
join public.visa_types t on t.visaai_id = 'no-visitor-visa'
join public.visa_countries c on c.id = t.country_id and c.code = 'NO'
on conflict do nothing;

do $$
declare n int;
begin
  select count(*) into n from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'no-visitor-visa';
  if n <> 2 then raise exception 'Expected 2 UDI sources, found %.', n; end if;
end $$;
