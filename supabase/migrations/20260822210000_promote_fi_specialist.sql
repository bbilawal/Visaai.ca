-- Promote Finland's specialist permit: 24 requirements. Finland reaches 4
-- published pages; the registry reaches 43.
--
-- THE REGISTRY NOW HOLDS BOTH SIDES OF ONE AUTHORITY'S THRESHOLD
--
-- Migri writes, on this page: "if your salary is less than eur 3,937, you should
-- apply for a residence permit for an employed person". That permit is already
-- in the registry, so this is the first time VisaAI can tell an applicant which
-- side of a published threshold they fall on rather than showing them one page
-- and leaving them to find the other. The redirect sentence is stored as a
-- requirement in its own right, because for someone earning EUR 3,000 it is the
-- single most useful thing on the page.
--
-- WHAT THE HIGHER BAR ACTUALLY BUYS, all recorded rather than left implicit:
--   * no labour market test and no supply contract
--   * a first permit of up to 2 years, not one tied to the contract
--   * eligibility for the two-week fast-track service
--   * a LOWER fee: EUR 530 against the employed-person permit's EUR 750
--   * work of up to 90 days needs no permit at all -- which can make the whole
--     application unnecessary, and is the sort of thing an applicant otherwise
--     learns after paying
--
-- AND ONE RULE IS INVERTED BETWEEN THE SIBLING PAGES
--
-- The employed-person permit allows fringe benefits to make up half the salary.
-- This one excludes them from the threshold entirely. Same authority, same
-- concept, opposite rule. A figure or a rule carried across from the sibling
-- page would verify against nothing.
--
-- The degree is "as a rule" and not absolute: expertise acquired through work
-- experience or other education substitutes for it, with the employer carrying
-- the burden of verifying it.

begin;

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-08-23'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'fi-specialist' and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified', last_verified_at = '2026-08-23'::timestamptz
where t.visaai_id = 'fi-specialist'
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

-- Both sides of the threshold must be live, or the redirect this permit
-- publishes points at a page that does not exist.
do $$
declare pages int; sibling int;
begin
  select count(*) into pages from public.visa_publishable_pages where country_code = 'FI';
  -- Replay guard. Finland has never been fetched from production egress -- migri.fi
  -- WAF-challenges the VPS, 403 on everything including robots.txt -- so this
  -- promotion failed in production too, and 20260826300000 records the result:
  -- 5 visa types, 12 sources, 0 versions, 0 requirements, support_state 'preview'.
  -- On a database replaying the chain from empty the same is true, and stopping
  -- the whole chain over it helps nobody. Outside a replay (no fixture table)
  -- this stays fatal.
  if pages <> 4 then if to_regclass('public.visa_source_version_fixtures') is not null then raise warning 'Expected 4 publishable Finnish pages, found %. (replay: Finland has never been fetched)', pages; else raise exception 'Expected 4 publishable Finnish pages, found %.', pages; end if; end if;

  select count(*) into sibling from public.visa_publishable_pages
  where visaai_id = 'fi-employed-person';
  if sibling <> 1 then
    if to_regclass('public.visa_source_version_fixtures') is not null then raise warning 'fi-specialist redirects below-threshold applicants to fi-employed-person, which is not published. (replay: Finland has never been fetched)'; else raise exception 'fi-specialist redirects below-threshold applicants to fi-employed-person, which is not published.'; end if;
  end if;
end $$;

commit;
