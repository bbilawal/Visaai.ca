-- Correct a false claim this system wrote about Migri's robots policy.
--
-- WHAT HAPPENED
--
-- Deploying Finland to production, the source monitor reported 12 blocked and
-- wrote `robots_state = 'disallowed'` on every migri.fi source. That is not
-- true. migri.fi's robots.txt ALLOWS these paths -- 9 disallow lines, none
-- matching, Crawl-delay 5 -- and that is what it serves to an ordinary client.
--
-- To the VPS it serves a Cloudflare managed challenge: HTTP 403 with
-- "Just a moment..." on every URL, INCLUDING /robots.txt. The block is on the
-- egress IP, not in the authority's policy.
--
-- WHY THE DISTINCTION IS WORTH A MIGRATION
--
-- 'disallowed' means "the authority told us not to read this, and we stop" --
-- there is nothing to be done and nothing to escalate. 'unknown' means "we
-- could not read the policy", which is a different situation with an actual
-- remedy: docs/operations/SOURCE_ACCESS.md describes contacting the authority
-- for access. An operator reading these rows would have concluded, wrongly,
-- that Migri had refused us.
--
-- It is also, plainly, the registry recording something untrue about a
-- government's published policy -- which is the one thing this system exists
-- not to do.
--
-- THE CODE THAT WROTE IT IS FIXED IN THE SAME COMMIT
--
-- visa-sync.service.ts set robots_state from the PAGE fetch outcome. A blocked
-- page says nothing about robots, so it no longer writes that column at all;
-- 'unknown' is written only when robots.txt itself could not be read. Two
-- regression tests cover both directions.
--
-- Requirements are unaffected: none was ever created for these sources, which
-- is why Finland's five visa types publish no detail pages on production. The
-- hub page is unaffected too -- the authority, the catalogue and the official
-- links are verified facts that do not depend on fetching the permit pages.

update public.visa_sources s
set robots_state = 'unknown'
from public.visa_types t
where t.id = s.visa_type_id
  and t.visaai_id like 'fi-%'
  and s.robots_state = 'disallowed';

do $$
declare wrong int;
begin
  select count(*) into wrong
  from public.visa_sources s
  join public.visa_types t on t.id = s.visa_type_id
  where t.visaai_id like 'fi-%' and s.robots_state = 'disallowed';
  if wrong > 0 then
    raise exception '% Finnish source(s) still claim robots-disallowed.', wrong;
  end if;
end $$;
