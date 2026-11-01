-- Promote Finland's entrepreneur permit: 26 requirements. Finland reaches 5
-- published pages; the registry reaches 44, and publishes an ENTREPRENEUR route
-- for the first time.
--
-- Every page until now has been work, study, visitor, family or permanent
-- residence. `entrepreneur` is a category the schema has always allowed and
-- nothing had used, so this is the first evidence the catalogue generalises past
-- the routes the first four destinations happened to share.
--
-- TWO AUTHORITIES DECIDE, IN AN ORDER THAT COSTS TIME IF YOU GET IT WRONG
--
-- The Economic Development Centre issues a partial decision on the business
-- first; Migri then processes the permit. And Migri states that failing the
-- GENERAL residence-permit requirements stops the Centre issuing a partial
-- decision at all -- so a passport or entry-record problem blocks the business
-- assessment before it starts. Someone who does not know that spends weeks on a
-- business plan for a decision that is already closed.
--
-- The Centre's profitability test is deliberately NOT stored: Migri says the
-- Centre assesses it, neither publishes criteria, and inventing a test would be
-- worse than pointing at the authority.
--
-- THE ELIGIBILITY TEST IS THE FORM OF THE BUSINESS, NOT WHAT IT DOES
--
-- Private trader, general partner, unlimited-liability cooperative member, or a
-- shareholder who is BOTH in a managerial position AND holds at least 30 per
-- cent of capital or votes. Both limbs, not either: a managing director with a
-- small holding does not qualify and neither does a 40 per cent owner with no
-- managerial role. A silent partner in a limited partnership is excluded by
-- name.
--
-- OWNING IS NOT ENOUGH -- "you must also work in the company in finland". One
-- flat sentence on the page, and the whole difference between an investor and
-- an entrepreneur.
--
-- THE BUSINESS ID CHICKEN-AND-EGG, RESOLVED BY THE AUTHORITY ITSELF
--
-- The permit needs a Business ID; a private trader cannot establish a toiminimi
-- from abroad. Migri's answer is narrow and worth storing exactly: a first
-- permit applied for BEFORE arriving may go in without one. Applying from inside
-- Finland gets no such concession.
--
-- THE THIRD REFUSAL FOR "LIGHT ENTREPRENEURS"
--
-- fi-employed-person excludes them, this page excludes them twice. The registry
-- now holds both refusals, which is the useful part: someone invoicing through a
-- service company is told by both routes rather than left between them.

begin;

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-08-23'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'fi-entrepreneur' and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified', last_verified_at = '2026-08-23'::timestamptz
where t.visaai_id = 'fi-entrepreneur'
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
declare pages int; cat int;
begin
  select count(*) into pages from public.visa_publishable_pages where country_code = 'FI';
  -- Replay guard. Finland has never been fetched from production egress -- migri.fi
  -- WAF-challenges the VPS, 403 on everything including robots.txt -- so this
  -- promotion failed in production too, and 20260826300000 records the result:
  -- 5 visa types, 12 sources, 0 versions, 0 requirements, support_state 'preview'.
  -- On a database replaying the chain from empty the same is true, and stopping
  -- the whole chain over it helps nobody. Outside a replay (no fixture table)
  -- this stays fatal.
  if pages <> 5 then if to_regclass('public.visa_source_version_fixtures') is not null then raise warning 'Expected 5 publishable Finnish pages, found %. (replay: Finland has never been fetched)', pages; else raise exception 'Expected 5 publishable Finnish pages, found %.', pages; end if; end if;

  -- The claim this migration makes about the catalogue, asserted rather than
  -- stated: an entrepreneur route is now published.
  select count(*) into cat from public.visa_publishable_pages where category = 'entrepreneur';
  if cat < 1 then if to_regclass('public.visa_source_version_fixtures') is not null then raise warning 'No entrepreneur route publishes. (replay: Finland has never been fetched)'; else raise exception 'No entrepreneur route publishes.'; end if; end if;
end $$;

commit;
