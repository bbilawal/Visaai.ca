-- Promote New Zealand's Working Holiday Visa: 18 requirements. NZ reaches 5
-- published pages; the registry reaches 47.
--
-- A PAGE WHOSE MOST IMPORTANT SENTENCE IS "THE NUMBERS ARE SOMEWHERE ELSE"
--
-- This is not one visa. It is ~45 bilateral schemes behind one URL, and INZ
-- states the consequence plainly: "the visa requirements for each country will
-- tell you: how old you have to be how long you can stay how much money you need
-- to bring with you any specific criteria and conditions."
--
-- So the four figures an applicant most wants are per-scheme and are NOT on this
-- page, and none is stored as a general one. What INZ does state outright IS
-- stored: the 18-30 band with its 18-35 exception, the three durations it names
-- (12 months, 23 for Canada, 36 for the UK), the employment and study limits,
-- and the medical rules.
--
-- WHAT VISAAI CANNOT ANSWER HERE, SAID OUT LOUD
--
-- INZ renders the list of agreement countries client-side; server-side it is an
-- empty heading. The registry therefore cannot tell an applicant whether their
-- nationality qualifies -- the FIRST gate on the route. Filling that in from
-- memory would be the exact fabrication the whole registry exists to prevent, so
-- the extraction records the gap instead. A visa page that says "we cannot check
-- this for you, here is the authority's page" is worth more than one that
-- guesses.
--
-- TWO WAYS TO SPEND THIS VISA WITHOUT EVER USING IT
--
--   1. You get a working holiday visa ONCE, "even if you do not use it". Arrive
--      later than 12 months after issue and it expires -- and the one-visa rule
--      has already been spent, so there is no second application.
--   2. A visa-waiver national who does not tick "i hold a temporary entry class
--      visa" on the New Zealand Traveller Declaration is given a VISITOR visa at
--      the border and the working holiday visa is CANCELLED. Same outcome: no
--      second application. A checkbox on an arrival form, not a document at
--      application, and it costs the entire visa.
--
-- OTHER THINGS EASY TO GET WRONG:
--   * Employment or contract for services only. No business ownership, no
--     permanent job -- narrower than these schemes are usually assumed to be.
--   * The holiday must be the MAIN purpose; INZ says work and study "should be
--     secondary intentions".
--   * The over-12-months medical threshold counts time on OTHER visas, so an
--     earlier stay can push a working holiday over it.
--   * Applying before your scheme opens is not queued -- the application is
--     deleted automatically.

begin;

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-08-23'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'nz-working-holiday-visa' and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified', last_verified_at = '2026-08-23'::timestamptz
where t.visaai_id = 'nz-working-holiday-visa'
  and exists (select 1 from public.visa_requirements r
              where r.visa_type_id = t.id and r.status = 'active');

do $$
declare bad int;
begin
  select count(*) into bad from public.visa_requirements
  where status = 'active'
    and (source_version_id is null or source_excerpt is null or source_excerpt = ''
         or (kind = 'recommended' and officially_required));
  if bad > 0 then raise exception '% active requirement(s) lack provenance.', bad; end if;
end $$;

do $$
declare pages int; wh int;
begin
  select count(*) into pages from public.visa_publishable_pages where country_code = 'NZ';
  if pages <> 5 then raise exception 'Expected 5 publishable New Zealand pages, found %.', pages; end if;

  select count(*) into wh from public.visa_publishable_pages where category = 'working_holiday';
  if wh < 1 then raise exception 'No working holiday route publishes.'; end if;
end $$;

commit;
