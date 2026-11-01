-- Give US Visa Waiver Program / ESTA two readable official sources.
--
-- THE PROBLEM
--
-- us-visa-waiver-program-esta was the last row the coverage matrix reported as
-- FAILED, and for an unusual reason. Its three registered sources fail in three
-- different ways:
--
--   * travel.state.gov landing  -> HTTP 403. The State Department's WAF blocks
--     identified automated agents. We have not worked around it.
--   * travel.state.gov fees     -> HTTP 403, same cause.
--   * esta.cbp.dhs.gov          -> HTTP 200, and STILL unusable: it is the live
--     application client, a JavaScript app whose served HTML contains no prose.
--     The monitor records `parse_error: normalization produced no text` rather
--     than pretending it read something, and it does not execute JavaScript to
--     get at the rendered DOM.
--
-- So the visa type had zero requirements not because nobody had extracted it,
-- but because there was nothing readable to extract FROM.
--
-- THE FIX
--
-- CBP publishes the same programme as ordinary server-rendered pages on
-- www.cbp.gov, a different host from the blocked travel.state.gov and the
-- JS-only esta.cbp.dhs.gov. Both return 200 with real prose, and between them
-- they state the substance: 42 participating countries, stays up to 90 days for
-- business or tourism without a visa, the mandatory e-passport, when to apply,
-- and that an approved ESTA is not admissibility.
--
-- ROBOTS
--
-- www.cbp.gov/robots.txt was fetched and read before this migration. It is a
-- stock Drupal robots.txt: one `User-agent: *` group whose Disallow entries
-- cover /core/, /profiles/, /admin/ and various README files. Nothing in it
-- mentions /travel, so these two paths are allowed. Verified, not assumed.
--
-- The three existing sources are LEFT REGISTERED and active. travel.state.gov is
-- the authoritative State Department page and esta.cbp.dhs.gov is where an
-- applicant actually applies; both belong in the record even while unreadable.
-- Deleting them would erase the evidence of what is blocked, which is exactly
-- what docs/operations/SOURCE_ACCESS.md exists to keep visible.

insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language,
  robots_state, redistribution, check_interval, freshness_sla, active
)
select
  c.id, t.id, v.role, 'U.S. Customs and Border Protection', 1,
  v.url, v.url, v.title, 'en',
  'allowed', 'unknown', interval '1 day', interval '30 days', true
from (values
  ('eligibility',
   'https://www.cbp.gov/travel/international-visitors/visa-waiver-program',
   'Visa Waiver Program'),
  ('requirements',
   'https://www.cbp.gov/travel/international-visitors/esta',
   'Electronic System for Travel Authorization (ESTA)')
) as v(role, url, title)
join public.visa_types t on t.visaai_id = 'us-visa-waiver-program-esta'
join public.visa_countries c on c.id = t.country_id and c.code = 'US'
on conflict do nothing;

do $$
declare readable int;
begin
  select count(*) into readable
  from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id = 'us-visa-waiver-program-esta'
    and s.source_url like 'https://www.cbp.gov/%';
  if readable <> 2 then
    raise exception
      'Expected 2 cbp.gov sources for us-visa-waiver-program-esta, found %. '
      'The visaai_id in this migration does not match the registry.', readable;
  end if;
end $$;
