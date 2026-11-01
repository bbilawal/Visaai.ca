-- Register three canada.ca pages the registry was missing.
--
-- Both gaps were surfaced by the coverage matrix, not by guesswork, and both
-- were fixed by reading the URL off the government's own page rather than
-- constructing one that looked plausible.
--
-- 1. ca-work-permit had NO eligibility source. Its four registered URLs are a
--    section index, a link hub, the IMM 1295 form page and the fee list — none
--    of which states who may apply. That is why it extracted the thinnest set
--    of the five Canadian types (3 conditions). The real page is linked from
--    the already-registered application page under the anchor text "Check if
--    you can apply".
--
-- 2. ca-business-visitors had NO source of any kind, which is why it is the one
--    Canadian visa type the coverage matrix reports as FAILED. IRCC publishes it
--    as a single self-contained five-step page; every "Step N" link on it is a
--    same-page anchor, so the one page IS the requirements document. The one
--    genuine outbound link is the letter-of-invitation page, registered
--    separately because it defines what that document must contain.
--
-- ROBOTS
--
-- canada.ca/robots.txt was fetched and read before this migration, not assumed.
-- It publishes a single `User-agent: *` group. The only Disallow anywhere in it
-- that touches this section is
-- `/en/immigration-refugees-citizenship/services/reference-include/`, which none
-- of these three paths is under. Hence robots_state 'allowed' — a verified
-- value, not a default.
--
-- redistribution stays 'unknown'. Crown copyright terms have not been assessed
-- for these pages and inventing a permission we have not checked is exactly the
-- kind of claim this column exists to prevent.
--
-- Registering a source does NOT create requirements. It makes the page eligible
-- for the daily sync, which produces a source_version, which extraction can then
-- quote. ca-business-visitors stays at zero requirements until that runs.

insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language,
  robots_state, redistribution, check_interval, freshness_sla, active
)
select
  c.id, t.id, v.role, 'Immigration, Refugees and Citizenship Canada', 1,
  v.url, v.url, v.title, 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from (values
  ('ca-work-permit', 'eligibility',
   'https://www.canada.ca/en/immigration-refugees-citizenship/services/work-canada/permit-outside/eligibility.html',
   'Work permit: Check if you can apply'),
  ('ca-business-visitors', 'application',
   'https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/business/visitors-events-conferences.html',
   'Business visitors: meetings, conferences and trade shows'),
  ('ca-business-visitors', 'documents',
   'https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/business/bring-business-guests/letter-invitation.html',
   'Letter of invitation for business visitors')
) as v(visaai_id, role, url, title)
join public.visa_types t on t.visaai_id = v.visaai_id
join public.visa_countries c on c.id = t.country_id and c.code = 'CA'
on conflict do nothing;

do $$
declare missing text;
begin
  select string_agg(t.visaai_id, ', ') into missing
  from public.visa_types t
  join public.visa_countries c on c.id = t.country_id and c.code = 'CA'
  where t.visaai_id in ('ca-work-permit', 'ca-business-visitors')
    and not exists (
      select 1 from public.visa_sources s
      where s.visa_type_id = t.id and s.role in ('eligibility', 'application')
    );
  if missing is not null then
    raise exception
      'Expected an eligibility/application source for: %. The visaai_id in this '
      'migration does not match the registry.', missing;
  end if;
end $$;
